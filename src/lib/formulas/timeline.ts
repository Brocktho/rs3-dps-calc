/**
 * Rotation timeline: ticks, Global Cooldown, and per-placement damage resolution.
 */
import type { Ability } from '../data/abilities';

export const TICK_SECONDS = 0.6;
export const GCD_TICKS = 3;

/** A single ability placed on the timeline. Deliberately minimal (no derived fields like
 *  tick span or off-GCD-ness) so it stays cleanly JSON-serializable for localStorage --
 *  those are re-derived from `abilityName` via a lookup wherever needed. */
export interface TimelinePlacement {
	id: string;
	abilityName: string;
	startTick: number;
}

export interface GearContext {
	isTwoHanded: boolean;
	hasOffHandWeapon: boolean;
	equippedCapeName: string | null;
}

/**
 * A small set of abilities (15 of 142, e.g. Dive, Bladed Dive, Surge, quiver ammo swaps, High
 * Alchemy) can be used without triggering the Global Cooldown, per their own wiki description --
 * there's no structural field for this in abilities.ts, so it's derived from the description text
 * rather than hand-annotating every entry.
 */
export function isOffGcdAbility(ability: Ability): boolean {
	return /can be (cast|used) during the global cooldown/i.test(ability.description);
}

/** GCD abilities occupy 3 ticks (1.8s); off-GCD abilities occupy just their own tick. */
export function abilityTickSpan(ability: Ability): number {
	return isOffGcdAbility(ability) ? 1 : GCD_TICKS;
}

/**
 * Parses a damage-percent string into a decimal multiplier: "250%" -> 2.5, a range like
 * "90%-110%" -> the midpoint 1.0. Returns null for "N/A"/null (non-damaging abilities).
 */
export function parseDamageMultiplier(raw: string | null): number | null {
	if (!raw) return null;
	const matches = raw.match(/(\d+(?:\.\d+)?)%/g);
	if (!matches || matches.length === 0) return null;
	const values = matches.map((m) => Number(m.slice(0, -1)));
	const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
	return avg / 100;
}

/**
 * Picks the right damageVariants entry for the player's current gear. Matches two-handed/
 * dual-wield/main-hand-only wording against the weapon config, and named igneous-cape variants
 * against the equipped cape; otherwise falls back to the "Any" key (or the first key if no "Any"
 * exists). Variants gated on a full equipment *set* (e.g. "4+ pieces of Tumeken's resplendence
 * equipment") are left on their fallback value -- this app has no "equipped set" concept anywhere
 * else either, so resolving those precisely is out of scope for now (same kind of documented
 * simplification as the unverified Magic styleTier value elsewhere in this codebase).
 */
export function resolveDamagePercent(ability: Ability, gear: GearContext): string | null {
	if (ability.damagePercent !== null) return ability.damagePercent;
	if (!ability.damageVariants) return null;

	const entries = Object.entries(ability.damageVariants);
	if (entries.length === 1) return entries[0][1];

	for (const [key, value] of entries) {
		const k = key.toLowerCase();
		if (k.includes('two-handed') || k.includes('two handed')) {
			if (gear.isTwoHanded) return value;
		} else if (k.includes('dual wield')) {
			if (!gear.isTwoHanded && gear.hasOffHandWeapon) return value;
		} else if (k.includes('main hand') || k.includes('main-hand')) {
			if (!gear.isTwoHanded && !gear.hasOffHandWeapon) return value;
		} else if (k.startsWith('igneous kal-') || k.includes('igneous kal-')) {
			if (
				gear.equippedCapeName &&
				k
					.split(/\s+or\s+/)
					.some((name) => name.trim() === gear.equippedCapeName!.toLowerCase())
			) {
				return value;
			}
		}
	}

	const anyEntry = entries.find(([key]) => key.toLowerCase() === 'any');
	return (anyEntry ?? entries[0])[1];
}

/** Computes the damage a single placed ability deals, given the player's current total Ability
 *  Damage (AD) figure and gear (for damageVariants resolution). */
export function abilityDamageForPlacement(
	ability: Ability,
	adTotal: number,
	gear: GearContext
): number {
	const raw = resolveDamagePercent(ability, gear);
	const multiplier = parseDamageMultiplier(raw);
	return multiplier === null ? 0 : Math.floor(adTotal * multiplier);
}

export function placementAbility(placement: TimelinePlacement, abilities: Ability[]): Ability | null {
	return abilities.find((a) => a.name === placement.abilityName) ?? null;
}

/**
 * How many times a placed ability actually hits, and when:
 * - 'single': one hit, on the start tick (the default -- most abilities, and also abilities whose
 *   description mentions a bare "N hits" with no timing, e.g. Adaptive Strike -- see note below).
 * - 'channel': N hits spread over time at a fixed interval, e.g. Assault ("Attack 4 times over
 *   4.2s (7 ticks)" -> hits at 0/2/4/6).
 *
 * Important: `Ability.damagePercent`/`damageVariants` is already the ability's TOTAL damage
 * summed across all its hits, not a per-hit value -- verified against 5 multi-hit abilities'
 * actual stored values (e.g. Rapid Fire: "75-85% Ranged damage per hit" x 8 hits = stored '640%'
 * exactly; Adaptive Strike dual-wield: "60-75% per hit" x 2 = stored '135%' exactly). So a bare
 * "N hits" with no spread timing doesn't need any special handling -- the stored total already
 * accounts for it, same as a single-hit ability. Only 'channel' abilities need special handling,
 * since their total damage needs to be divided across the ticks it's spread over (and reduced
 * proportionally if the channel gets interrupted -- see resolveChannels).
 */
export type HitProfile = { kind: 'single' } | { kind: 'channel'; hits: number; intervalTicks: number };

/**
 * Parses the ability's channel/DoT hit timing from its description text. Two phrasings appear in
 * the data, both verified consistently worded via a full-file grep:
 *   1. "Attack N times over X.Xs (Y ticks)" -- total window given; interval = round((Y-1)/(N-1)).
 *   2. "... per hit every X.Xs (Y ticks) ... N hits." -- interval given directly as Y.
 * Everything else (including a bare "N hits." with no timing, e.g. Adaptive Strike) is 'single'.
 */
export function parseHitProfile(ability: Ability): HitProfile {
	const windowMatch = ability.description.match(
		/attack (\d+) times over [\d.]+s \((\d+) ticks?\)/i
	);
	if (windowMatch) {
		const hits = Number(windowMatch[1]);
		const windowTicks = Number(windowMatch[2]);
		if (hits > 1) {
			const intervalTicks = Math.round((windowTicks - 1) / (hits - 1));
			return { kind: 'channel', hits, intervalTicks };
		}
	}

	const everyMatch = ability.description.match(/every [\d.]+s \((\d+) ticks?\)/i);
	const hitsMatch = ability.description.match(/(\d+)\s*hits?\.?/i);
	if (everyMatch && hitsMatch) {
		const intervalTicks = Number(everyMatch[1]);
		const hits = Number(hitsMatch[1]);
		if (hits > 1) return { kind: 'channel', hits, intervalTicks };
	}

	return { kind: 'single' };
}

export interface BuffInfo {
	durationTicks: number;
}

/**
 * Parses a self-buff's duration from its description. The phrase "X.Xs (Y ticks) duration" is
 * used exclusively for effects applied to the player (Berserk, Sunshine, Anima Charged, courage
 * buffs, ...) -- enemy-targeted effect durations are worded differently ("Stuns the target for
 * X ticks", no trailing "duration"), verified across all 36 matches in the data. Durations that
 * self-extend on repeat casts/hits (e.g. Devotion) aren't modeled -- just the base duration.
 */
export function parseBuffInfo(ability: Ability): BuffInfo | null {
	const match = ability.description.match(/[\d.]+s \((\d+) ticks?\) duration/i);
	if (!match) return null;
	return { durationTicks: Number(match[1]) };
}

/** Deterministic string-hash -> HSL color, so every distinct buff/channel ability gets a stable,
 *  visually distinct color with no manual color curation needed. */
export function colorForAbility(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = (hash * 31 + name.charCodeAt(i)) | 0;
	}
	const hue = Math.abs(hash) % 360;
	return `hsl(${hue}, 65%, 55%)`;
}

export interface ResolvedChannel {
	placementId: string;
	abilityName: string;
	startTick: number;
	/** Hit ticks that actually land, after truncating for interruption (see below). */
	hitTicks: number[];
	/** Exclusive end tick for rendering the channel's box -- either its natural completion or the
	 *  tick of the ability that interrupted it, whichever is earlier. */
	barEndTick: number;
}

/**
 * Resolves every channelled/DoT placement's actual hit ticks. A channel keeps hitting on its
 * natural schedule unless interrupted: if the player places another GCD-consuming ability
 * anywhere before the channel's natural last hit, every scheduled hit at or after that ability's
 * own start tick is cancelled (lost) -- matches the real mechanic (using your next ability cancels
 * the rest of the channel), confirmed by the user against Assault. The channel's own GCD block
 * stays the normal 3 ticks regardless -- interruption only affects how much of ITS damage lands,
 * never where other abilities can be placed (that's still just `canPlaceAbility`/GCD collision).
 * Off-GCD placements never interrupt a channel.
 */
export function resolveChannels(
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number
): ResolvedChannel[] {
	const gcdPlacements = placements
		.filter((p) => {
			const ability = placementAbility(p, abilities);
			return ability && !isOffGcdAbility(ability);
		})
		.sort((a, b) => a.startTick - b.startTick);

	const result: ResolvedChannel[] = [];
	for (const placement of placements) {
		const ability = placementAbility(placement, abilities);
		if (!ability) continue;
		const profile = parseHitProfile(ability);
		if (profile.kind !== 'channel') continue;

		const naturalHitTicks = Array.from(
			{ length: profile.hits },
			(_, i) => placement.startTick + i * profile.intervalTicks
		).filter((t) => t < timelineLength);

		const nextGcd = gcdPlacements.find((p) => p.startTick > placement.startTick);
		const cutoffTick = nextGcd ? nextGcd.startTick : Infinity;

		const hitTicks = naturalHitTicks.filter((t) => t < cutoffTick);
		const naturalEnd = naturalHitTicks[naturalHitTicks.length - 1] + 1;
		const barEndTick = Math.min(naturalEnd, cutoffTick, timelineLength);

		result.push({
			placementId: placement.id,
			abilityName: placement.abilityName,
			startTick: placement.startTick,
			hitTicks,
			barEndTick
		});
	}
	return result;
}

export interface ResolvedBuff {
	placementId: string;
	abilityName: string;
	startTick: number;
	endTick: number;
}

/** Resolves every self-buff placement's active window. Buffs expire on their own fixed timer --
 *  no interruption logic (unlike channels, casting another ability doesn't cancel a buff). */
export function resolveBuffs(
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number
): ResolvedBuff[] {
	const result: ResolvedBuff[] = [];
	for (const placement of placements) {
		const ability = placementAbility(placement, abilities);
		if (!ability) continue;
		const buff = parseBuffInfo(ability);
		if (!buff) continue;
		result.push({
			placementId: placement.id,
			abilityName: placement.abilityName,
			startTick: placement.startTick,
			endTick: Math.min(placement.startTick + buff.durationTicks, timelineLength)
		});
	}
	return result;
}

/**
 * Greedy interval-lane packing (like a calendar day-view): sorts by start tick and assigns each
 * item to the first lane whose last item already ended, opening a new lane otherwise. Overlapping
 * items get separate lanes; non-overlapping items share lane 0. Shared by the buff and channel
 * lanes in the UI.
 */
export function packIntoLanes<T extends { startTick: number; endTick: number }>(
	items: T[]
): (T & { lane: number })[] {
	const sorted = [...items].sort((a, b) => a.startTick - b.startTick);
	const laneEndTicks: number[] = [];
	const result: (T & { lane: number })[] = [];
	for (const item of sorted) {
		let lane = laneEndTicks.findIndex((end) => end <= item.startTick);
		if (lane === -1) {
			lane = laneEndTicks.length;
			laneEndTicks.push(item.endTick);
		} else {
			laneEndTicks[lane] = item.endTick;
		}
		result.push({ ...item, lane });
	}
	return result;
}

export function rangesOverlap(aStart: number, aSpan: number, bStart: number, bSpan: number): boolean {
	return aStart < bStart + bSpan && bStart < aStart + aSpan;
}

/**
 * Whether `ability` can be placed at `startTick`. Off-GCD abilities never collide -- they can
 * stack on top of a GCD ability (or another off-GCD ability) at the same tick. GCD-consuming
 * abilities must not overlap any *other* GCD-consuming placement's 3-tick span (excludeId lets a
 * placement being dragged/moved ignore collision against itself).
 */
export function canPlaceAbility(
	ability: Ability,
	startTick: number,
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	excludeId?: string
): boolean {
	const span = abilityTickSpan(ability);
	if (startTick < 0 || startTick + span > timelineLength) return false;
	if (isOffGcdAbility(ability)) return true;

	return !placements.some((p) => {
		if (p.id === excludeId) return false;
		const other = placementAbility(p, abilities);
		if (!other || isOffGcdAbility(other)) return false;
		return rangesOverlap(startTick, span, p.startTick, abilityTickSpan(other));
	});
}

/**
 * If dragging the placement `movingId` to `targetTick` collides with exactly one other
 * GCD-consuming placement, returns that other placement so the caller can perform a swap instead
 * of rejecting the drop. A "swap" means each ability takes over the OTHER's exact original start
 * tick -- not the raw tick the pointer happened to be dropped at. This matters: the drop can
 * partially overlap the target (e.g. dropped 1 tick off from its start) rather than landing
 * exactly on it, and placing the mover at that raw tick while bumping the target to the mover's
 * old tick can leave the two new positions overlapping each other (neither placement ever gets
 * validated against the other's genuinely final spot). Exchanging their existing start ticks
 * instead is always safe with no extra validation needed: both positions were already mutually
 * non-overlapping (and non-overlapping with every other placement) before the drag, and every
 * GCD-consuming ability shares the same fixed 3-tick span, so trading which ability occupies
 * which of those two ticks can never introduce a new collision.
 * Off-GCD abilities are never swap candidates -- they never collide in the first place (see
 * canPlaceAbility), so dropping one onto another just stacks them as usual.
 */
export function findSwapTarget(
	movingId: string,
	targetTick: number,
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number
): TimelinePlacement | null {
	const moving = placements.find((p) => p.id === movingId);
	const movingAbility = moving ? placementAbility(moving, abilities) : null;
	if (!moving || !movingAbility || isOffGcdAbility(movingAbility)) return null;

	const span = abilityTickSpan(movingAbility);
	const conflicts = placements.filter((p) => {
		if (p.id === movingId) return false;
		const other = placementAbility(p, abilities);
		if (!other || isOffGcdAbility(other)) return false;
		return rangesOverlap(targetTick, span, p.startTick, abilityTickSpan(other));
	});
	return conflicts.length === 1 ? conflicts[0] : null;
}

/** Finds the GCD-consuming placement (if any) whose 3-tick span covers `tick`. Used to detect
 *  when a drag is hovering over an existing ability's icon closely enough to offer inserting
 *  before/after it, rather than placing/swapping at that tick. */
export function gcdPlacementAt(
	tick: number,
	placements: TimelinePlacement[],
	abilities: Ability[]
): TimelinePlacement | null {
	for (const p of placements) {
		const ability = placementAbility(p, abilities);
		if (!ability || isOffGcdAbility(ability)) continue;
		const span = abilityTickSpan(ability);
		if (tick >= p.startTick && tick < p.startTick + span) return p;
	}
	return null;
}

/** Shifts every placement at or after `pivotTick` later by `span` ticks, to make room for
 *  something being inserted at `pivotTick`. */
export function shiftPlacementsFrom(
	placements: TimelinePlacement[],
	pivotTick: number,
	span: number
): TimelinePlacement[] {
	return placements.map((p) =>
		p.startTick >= pivotTick ? { ...p, startTick: p.startTick + span } : p
	);
}

/** Removes `removedId` and closes the resulting gap by shifting every placement that was after it
 *  earlier by the removed ability's own span -- the inverse of shiftPlacementsFrom. Used when
 *  reordering an existing placement: cut it from its old spot (closing the gap) before
 *  re-inserting it elsewhere, so moving an ability reads as a reorder rather than leaving a hole. */
export function removePlacementCloseGap(
	placements: TimelinePlacement[],
	abilities: Ability[],
	removedId: string
): TimelinePlacement[] {
	const removed = placements.find((p) => p.id === removedId);
	if (!removed) return placements;
	const removedAbility = placementAbility(removed, abilities);
	const span = removedAbility ? abilityTickSpan(removedAbility) : 0;
	return placements
		.filter((p) => p.id !== removedId)
		.map((p) => (p.startTick > removed.startTick ? { ...p, startTick: p.startTick - span } : p));
}

/**
 * Inserts `ability` immediately before or after the GCD placement `anchorId`, shifting every
 * placement at/after the insertion point later by the inserted ability's span. This ripples
 * through GCD abilities, off-GCD abilities, and (since they're derived from placement start
 * ticks) buff/channel timing alike, keeping everything after the insertion point in sync.
 *
 * `placementId` is the id the resulting placement should end up with. If it already exists in
 * `placements`, this is treated as a reorder: that placement is first removed from its old spot
 * with the gap closed behind it (via removePlacementCloseGap), so the net effect reads as moving
 * it to a new position rather than adding a duplicate. Otherwise it's inserted as a brand new
 * placement (the caller is expected to generate a fresh id for this case).
 *
 * Returns null if the anchor doesn't exist, isn't a GCD-consuming placement, or is the same
 * placement as the one being reordered.
 */
export function insertAbilityAtAnchor(
	placements: TimelinePlacement[],
	abilities: Ability[],
	ability: Ability,
	anchorId: string,
	side: 'before' | 'after',
	placementId: string
): TimelinePlacement[] | null {
	if (placementId === anchorId) return null;

	const isReorder = placements.some((p) => p.id === placementId);
	const working = isReorder
		? removePlacementCloseGap(placements, abilities, placementId)
		: placements;

	const anchor = working.find((p) => p.id === anchorId);
	const anchorAbility = anchor ? placementAbility(anchor, abilities) : null;
	if (!anchor || !anchorAbility || isOffGcdAbility(anchorAbility)) return null;

	const pivotTick =
		side === 'before' ? anchor.startTick : anchor.startTick + abilityTickSpan(anchorAbility);
	const shifted = shiftPlacementsFrom(working, pivotTick, abilityTickSpan(ability));

	return [...shifted, { id: placementId, abilityName: ability.name, startTick: pivotTick }];
}

/** The furthest tick any placement's GCD span, buff duration, or channel window reaches -- used
 *  to auto-extend the timeline when an insert pushes things past its current length. */
export function requiredTimelineLength(
	placements: TimelinePlacement[],
	abilities: Ability[]
): number {
	let max = 0;
	for (const p of placements) {
		const ability = placementAbility(p, abilities);
		if (!ability) continue;
		max = Math.max(max, p.startTick + abilityTickSpan(ability));

		const buff = parseBuffInfo(ability);
		if (buff) max = Math.max(max, p.startTick + buff.durationTicks);

		const profile = parseHitProfile(ability);
		if (profile.kind === 'channel') {
			max = Math.max(max, p.startTick + (profile.hits - 1) * profile.intervalTicks + 1);
		}
	}
	return max;
}

/** First tick (0-indexed) where `ability` can legally be placed, for click-to-place. Returns
 *  null if the timeline has no room left for it. */
export function nextOpenTick(
	ability: Ability,
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number
): number | null {
	const span = abilityTickSpan(ability);
	for (let tick = 0; tick + span <= timelineLength; tick++) {
		if (canPlaceAbility(ability, tick, placements, abilities, timelineLength)) return tick;
	}
	return null;
}

/**
 * Sums each placement's damage into the ticks it actually lands on. Single-hit abilities credit
 * their full `abilityDamageForPlacement` total to the start tick, unchanged. Channelled/DoT
 * abilities divide that same total evenly across their hits (their stored damagePercent is
 * already the ability's full total, not a per-hit value -- see parseHitProfile) and credit one
 * share to each of `resolveChannels`'s surviving hit ticks, so an interrupted channel's damage
 * total drops proportionally to match its visually-truncated hit window.
 */
export function damageByTick(
	placements: TimelinePlacement[],
	abilities: Ability[],
	adTotal: number,
	gear: GearContext,
	timelineLength: number
): number[] {
	const result = new Array(timelineLength).fill(0);
	const channels = resolveChannels(placements, abilities, timelineLength);

	for (const placement of placements) {
		const ability = placementAbility(placement, abilities);
		if (!ability) continue;
		if (placement.startTick < 0 || placement.startTick >= timelineLength) continue;

		const profile = parseHitProfile(ability);
		const totalDamage = abilityDamageForPlacement(ability, adTotal, gear);

		if (profile.kind === 'channel') {
			const resolved = channels.find((c) => c.placementId === placement.id);
			const perHitDamage = Math.floor(totalDamage / profile.hits);
			for (const tick of resolved?.hitTicks ?? []) {
				result[tick] += perHitDamage;
			}
		} else {
			result[placement.startTick] += totalDamage;
		}
	}
	return result;
}

/** Running cumulative sum, e.g. for a cumulative-damage chart line. */
export function cumulativeDamage(byTick: number[]): number[] {
	const result: number[] = [];
	let sum = 0;
	for (const dmg of byTick) {
		sum += dmg;
		result.push(sum);
	}
	return result;
}

/** Running average DPS at each tick: total damage so far / elapsed time so far. */
export function runningAverageDps(byTick: number[], tickSeconds = TICK_SECONDS): number[] {
	const cumulative = cumulativeDamage(byTick);
	return cumulative.map((total, i) => total / ((i + 1) * tickSeconds));
}
