/**
 * Rotation timeline: ticks, Global Cooldown, and per-placement damage resolution.
 */
import type { Ability } from '../data/abilities';
import type { CombatStyle } from './abilityDamage';
import type { BuffWindowModifier, Modifier, ModifierContext, PassiveModifier } from './modifiers';
import { resolveResource, type ResourceDefinition, type ResourceState } from './resources';

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
				k.split(/\s+or\s+/).some((name) => name.trim() === gear.equippedCapeName!.toLowerCase())
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

export function placementAbility(
	placement: TimelinePlacement,
	abilities: Ability[]
): Ability | null {
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
export type HitProfile =
	{ kind: 'single' } | { kind: 'channel'; hits: number; intervalTicks: number };

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

/** A single duration-extension event actually applied to a ResolvedBuff, in the order it
 *  happened -- lets the UI show not just the final (possibly-extended) bar width, but exactly
 *  when and by what each extension occurred, e.g. a marker at each Rapid Fire hit tick labeled
 *  "Rapid Fire +1 tick" rather than the bar simply appearing wider with no visible cause. */
export interface AppliedBuffExtension {
	tick: number;
	extendTicks: number;
	sourceAbilityName: string;
}

export interface ResolvedBuff {
	placementId: string;
	abilityName: string;
	startTick: number;
	endTick: number;
	/** Chronological log of every extension applied to this buff instance, e.g. 8 entries for
	 *  a full Rapid Fire channel each extending Galeshot's Searing Winds by 1 tick. Empty for a
	 *  buff that was never extended. */
	extensions: AppliedBuffExtension[];
}

export interface BuffExtension {
	/** The buff's own in-game display name as written in ability descriptions, e.g. "Searing
	 *  Winds" or "Shadow imbued" -- distinct from the casting ability's name (see
	 *  BUFF_DISPLAY_NAME_TO_ABILITY_NAME) since the two only sometimes coincide (Berserk does,
	 *  Galeshot's "Searing Winds" and Imbue: Shadows' "Shadow imbued" don't). */
	buffDisplayName: string;
	extendTicks: number;
}

/** A run of one or more consecutive same-source extension events collapsed into a single
 *  visual segment -- e.g. Rapid Fire's 8 individual +1-tick hits become one
 *  `{ eventCount: 8, totalExtendTicks: 8 }` segment spanning the whole extended range, rather
 *  than 8 separate notches for what is, visually, one continuous "Rapid Fire is extending this
 *  buff" event. A single non-repeated extension (Shadow Tendrils' one-off +6) is still a
 *  "group" of size 1 -- the grouping is about presentation, not a different code path. */
export interface BuffExtensionGroup {
	sourceAbilityName: string;
	/**
	 * The tick range covering ONLY the time this group actually added to the buff -- from the
	 * buff's own end tick immediately before this group's first event applied, to its end tick
	 * immediately after the group's last event applied. E.g. Shadow Tendrils cast at tick 5
	 * against a buff that would otherwise end at tick 50 highlights ticks 50-56 (the added
	 * tail), NOT ticks 5-56 (the whole remaining buff) -- confirmed directly by the user, who
	 * wants the highlight to show exactly the extra time gained, not everything from the cast
	 * onward. Likewise Rapid Fire's 8 hits highlight only the ticks appended by those hits.
	 */
	startTick: number;
	endTick: number;
	totalExtendTicks: number;
	eventCount: number;
}

/** A buff's own endTick with every applied extension backed out -- i.e. what its endTick would
 *  have been from just its base duration, before anything extended it. Used to seed
 *  groupBuffExtensions' gap detection for the very first group. */
export function buffBaseEndTick(buff: ResolvedBuff): number {
	return buff.endTick - buff.extensions.reduce((sum, e) => sum + e.extendTicks, 0);
}

/**
 * Collapses a buff's chronological extension log into visual groups: consecutive events from
 * the SAME source ability, where each next event's tick falls within the range the buff was
 * already extended to by that same run (i.e. no gap -- the extensions are back-to-back, not two
 * separate bursts from the same ability with a pause between them), are merged into one group. A
 * gap or a change in source ability starts a new group. `buffBaseEndTick` is the buff's own
 * endTick with NO extensions applied (startTick + its base duration, pre-clamping), used only to
 * detect whether the very first event was itself "immediate" (landed before the buff would have
 * otherwise ended) -- it does not otherwise participate once the first group exists.
 */
export function groupBuffExtensions(
	extensions: AppliedBuffExtension[],
	buffBaseEndTick: number
): BuffExtensionGroup[] {
	const groups: BuffExtensionGroup[] = [];

	for (const event of extensions) {
		const current = groups[groups.length - 1];
		const priorEnd = current ? current.endTick : buffBaseEndTick;
		const isContinuation = current?.sourceAbilityName === event.sourceAbilityName;

		if (isContinuation) {
			current.endTick = priorEnd + event.extendTicks;
			current.totalExtendTicks += event.extendTicks;
			current.eventCount += 1;
		} else {
			groups.push({
				sourceAbilityName: event.sourceAbilityName,
				startTick: priorEnd,
				endTick: priorEnd + event.extendTicks,
				totalExtendTicks: event.extendTicks,
				eventCount: 1
			});
		}
	}

	return groups;
}

/**
 * Maps a buff's in-game display name (as it appears in OTHER abilities' "Extends the duration
 * of X" text) to the name of the ability that actually casts/owns that buff -- i.e. the name
 * `ResolvedBuff.abilityName` uses. Only needed where the two differ; add an entry here whenever
 * a newly-modeled extension effect names a buff whose casting ability isn't obvious from the
 * string alone.
 */
const BUFF_DISPLAY_NAME_TO_ABILITY_NAME: Record<string, string> = {
	'searing winds': 'Galeshot',
	'shadow imbued': 'Imbue: Shadows'
};

function buffCastingAbilityName(buffDisplayName: string): string {
	return BUFF_DISPLAY_NAME_TO_ABILITY_NAME[buffDisplayName.toLowerCase()] ?? buffDisplayName;
}

/**
 * Parses a "Extends the duration of <Buff> by X.Xs (Y ticks)" clause from an ability's
 * description -- covers both a single-cast extension (Shadow Tendrils -> Imbue: Shadows, +6
 * ticks on its own placement tick) and a per-hit extension on a channelled ability (Rapid Fire
 * -> Galeshot's Searing Winds, Greater Flurry -> Berserk: each of the ability's own hits, per
 * parseHitProfile, extends the target buff by this amount independently -- confirmed directly
 * by the user for Rapid Fire/Galeshot, and the identical phrasing on Greater Flurry/Berserk).
 */
export function parseBuffExtension(ability: Ability): BuffExtension | null {
	const match = ability.description.match(
		/extends the duration of ([a-z ]+?) by [\d.]+s \((\d+) ticks?\)/i
	);
	if (!match) return null;
	return { buffDisplayName: match[1].trim(), extendTicks: Number(match[2]) };
}

/**
 * Resolves every self-buff placement's active window, then applies any buff-duration extensions
 * from OTHER placements on top. Extensions are chronological: an extending placement/hit can
 * only push out a buff's endTick if the buff is still active (or already started) at that tick,
 * and only extends the SOONEST-ending currently-tracked instance of that buff -- an extension
 * can't resurrect an already-expired buff or retroactively affect one that hasn't started yet.
 * Channelled extenders (Rapid Fire, Greater Flurry) apply once per landed hit tick (per
 * resolveChannels), not once per cast, since each individual attack extends independently.
 */
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
			endTick: Math.min(placement.startTick + buff.durationTicks, timelineLength),
			extensions: []
		});
	}

	// Collect every extension EVENT (a tick at which some ability's hit/cast extends a named
	// buff), then apply them to `result` in chronological order so a buff already extended by
	// an earlier event correctly reflects that when a later event checks whether it's active.
	const events: {
		tick: number;
		targetAbilityName: string;
		extendTicks: number;
		sourceAbilityName: string;
	}[] = [];
	const channels = resolveChannels(placements, abilities, timelineLength);
	for (const placement of placements) {
		const ability = placementAbility(placement, abilities);
		if (!ability) continue;
		const extension = parseBuffExtension(ability);
		if (!extension) continue;
		const targetAbilityName = buffCastingAbilityName(extension.buffDisplayName);

		const channel = channels.find((c) => c.placementId === placement.id);
		if (channel) {
			for (const hitTick of channel.hitTicks) {
				events.push({
					tick: hitTick,
					targetAbilityName,
					extendTicks: extension.extendTicks,
					sourceAbilityName: ability.name
				});
			}
		} else {
			events.push({
				tick: placement.startTick,
				targetAbilityName,
				extendTicks: extension.extendTicks,
				sourceAbilityName: ability.name
			});
		}
	}
	events.sort((a, b) => a.tick - b.tick);

	for (const event of events) {
		// The soonest-ending instance of the target buff that's already active (or starts no
		// later than this tick) by this point -- matches how a single buff instance, not every
		// past cast of that ability, is what's actually running in-game.
		const candidates = result
			.filter((b) => b.abilityName === event.targetAbilityName && b.startTick <= event.tick)
			.sort((a, b) => a.endTick - b.endTick);
		const active = candidates.find((b) => event.tick < b.endTick);
		if (!active) continue; // buff already expired (or never cast) -- extension has no effect
		active.endTick = Math.min(active.endTick + event.extendTicks, timelineLength);
		active.extensions.push({
			tick: event.tick,
			extendTicks: event.extendTicks,
			sourceAbilityName: event.sourceAbilityName
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

export function rangesOverlap(
	aStart: number,
	aSpan: number,
	bStart: number,
	bSpan: number
): boolean {
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

/** Extracts an ability's cooldown length directly from its scraped `cooldownText`, e.g.
 *  "10.2 seconds (17 ticks)" -> 17. Every value in the data is consistently worded this way. */
export function parseCooldownTicks(ability: Ability): number {
	const match = ability.cooldownText.match(/\((\d+) ticks?\)/i);
	return match ? Number(match[1]) : 0;
}

export interface ConditionalCooldown {
	requiresActiveBuff: string;
	cooldownTicks: number;
}

/**
 * Hand-curated overrides for abilities whose cooldown changes while another buff is active --
 * this genuinely isn't present anywhere in the scraped wiki text (Overpower's own cooldownText is
 * just "30 seconds (50 ticks)", description says nothing about Berserk), so these are real in-game
 * values provided directly by the user rather than derived. Add more entries here as they come up.
 */
export const CONDITIONAL_COOLDOWNS: Record<string, ConditionalCooldown[]> = {
	Overpower: [{ requiresActiveBuff: 'Berserk', cooldownTicks: 15 }]
};

/** The cooldown (in ticks) that applies to a specific use of `ability` at `atTick`, accounting for
 *  any active buff that changes it (see CONDITIONAL_COOLDOWNS) -- falls back to the ability's own
 *  parsed cooldownText when no override applies. */
export function effectiveCooldownTicks(
	ability: Ability,
	atTick: number,
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number
): number {
	const overrides = CONDITIONAL_COOLDOWNS[ability.name];
	if (overrides) {
		const activeBuffs = resolveBuffs(placements, abilities, timelineLength);
		for (const override of overrides) {
			const isActive = activeBuffs.some(
				(b) =>
					b.abilityName === override.requiresActiveBuff &&
					atTick >= b.startTick &&
					atTick < b.endTick
			);
			if (isActive) return override.cooldownTicks;
		}
	}
	return parseCooldownTicks(ability);
}

/**
 * Whether placing/moving `ability` to `tick` respects its own cooldown against every OTHER
 * placement of the same ability -- checked bidirectionally (an earlier use blocks a too-soon later
 * one, and vice versa when moving something earlier than an existing later use), each measured
 * from whichever use comes first using ITS OWN effective cooldown. Identical ticks are always
 * rejected. Checked at the moment of a placement action only, same as canPlaceAbility -- no
 * retroactive re-validation of the rest of the timeline.
 */
export function respectsCooldown(
	ability: Ability,
	tick: number,
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	excludeId?: string
): boolean {
	return placements.every((p) => {
		if (p.id === excludeId || p.abilityName !== ability.name) return true;
		if (p.startTick === tick) return false;
		const earlierTick = Math.min(p.startTick, tick);
		const laterTick = Math.max(p.startTick, tick);
		const cd = effectiveCooldownTicks(ability, earlierTick, placements, abilities, timelineLength);
		return laterTick - earlierTick >= cd;
	});
}

/**
 * After committing `ability` to `finalTick`, removes any OTHER same-name placement that would now
 * violate cooldown against it -- used instead of blocking a move outright. This covers two related
 * cases: dragging a repeat use earlier so it lands right up against (or exactly on) an existing
 * later use of the same ability in an already tightly-packed rotation (in which case forward
 * cooldown-snapping alone would just recompute back to that spot, making the placement look frozen
 * -- clearing the conflicting neighbor instead of endlessly re-snapping is what actually lets it
 * move), and the more direct case the user described: dragging a use closer in time to a *later*
 * existing use of itself should bump that now-too-soon future use off the timeline, not refuse the
 * drag or silently leave the timeline in a cooldown-violating state.
 */
export function clearConflictingUses(
	ability: Ability,
	finalTick: number,
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	excludeId?: string
): TimelinePlacement[] {
	return placements.filter((p) => {
		if (p.id === excludeId || p.abilityName !== ability.name) return true;
		if (p.startTick === finalTick) return false;
		const earlierTick = Math.min(p.startTick, finalTick);
		const laterTick = Math.max(p.startTick, finalTick);
		const cd = effectiveCooldownTicks(ability, earlierTick, placements, abilities, timelineLength);
		return laterTick - earlierTick >= cd;
	});
}

/**
 * The earliest tick at or after `fromTick` where `ability` would satisfy its own cooldown against
 * every existing same-name placement -- pushes forward past any cooldown window covering the
 * candidate, looping until stable (handles the rare case of one push landing inside another
 * window). Powers the drag ghost's forward-snap when hovering a cooldown-blocked spot.
 */
export function earliestAvailableTick(
	ability: Ability,
	fromTick: number,
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	excludeId?: string
): number {
	let candidate = Math.max(0, fromTick);
	let changed = true;
	while (changed) {
		changed = false;
		for (const p of placements) {
			if (p.id === excludeId || p.abilityName !== ability.name) continue;
			if (p.startTick > candidate) continue;
			const blockedUntil =
				p.startTick +
				effectiveCooldownTicks(ability, p.startTick, placements, abilities, timelineLength);
			if (candidate < blockedUntil) {
				candidate = blockedUntil;
				changed = true;
			}
		}
	}
	return candidate;
}

export interface CooldownZone {
	startTick: number;
	endTick: number;
}

/** One blocked zone per existing placement of `abilityName`, for rendering the red cooldown-zone
 *  band(s) while dragging that ability. Off-GCD abilities have real cooldowns too (e.g. Dive is 34
 *  ticks despite not using the GCD), so this isn't limited to GCD-consuming abilities. */
export function cooldownZonesFor(
	abilityName: string,
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	excludeId?: string
): CooldownZone[] {
	const ability = abilities.find((a) => a.name === abilityName);
	if (!ability) return [];
	return placements
		.filter((p) => p.id !== excludeId && p.abilityName === abilityName)
		.map((p) => ({
			startTick: p.startTick,
			endTick: Math.min(
				p.startTick +
					effectiveCooldownTicks(ability, p.startTick, placements, abilities, timelineLength),
				timelineLength
			)
		}))
		.filter((z) => z.endTick > z.startTick);
}

/** Exclusive end tick of a channelled ability's full natural hit duration (its LAST hit tick + 1),
 *  regardless of its GCD block's own (always-3-tick) span -- e.g. Rapid Fire occupies its 3-tick
 *  GCD block like any other ability, but its 8 hits over 8 ticks means its natural channel window
 *  actually reaches further than that block alone. Null for a non-channelled ability. Same formula
 *  `requiredTimelineLength` already uses for a channel's reach. */
function channelNaturalEndTick(ability: Ability, startTick: number): number | null {
	const profile = parseHitProfile(ability);
	if (profile.kind !== 'channel') return null;
	return startTick + (profile.hits - 1) * profile.intervalTicks + 1;
}

/** First tick (0-indexed) where `ability` can legally be placed, for click-to-place. Skips past
 *  any existing channelled placement's FULL natural duration (not just its 3-tick GCD block) --
 *  click-to-place assumes the user wants any currently-running channel to finish uninterrupted,
 *  rather than landing partway through it and truncating it per resolveChannels' interruption
 *  behavior (dragging a placement to an exact tick can still deliberately interrupt a channel;
 *  this only affects the auto-picked slot for a plain palette click). Returns null if the timeline
 *  has no room left for it. */
export function nextOpenTick(
	ability: Ability,
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number
): number | null {
	const span = abilityTickSpan(ability);
	const channelEndTicks = placements
		.map((p) => {
			const placed = placementAbility(p, abilities);
			return placed ? channelNaturalEndTick(placed, p.startTick) : null;
		})
		.filter((t): t is number => t !== null);

	for (let tick = 0; tick + span <= timelineLength; tick++) {
		if (channelEndTicks.some((endTick) => tick < endTick)) continue;
		if (
			canPlaceAbility(ability, tick, placements, abilities, timelineLength) &&
			respectsCooldown(ability, tick, placements, abilities, timelineLength)
		) {
			return tick;
		}
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

/**
 * Hand-curated hit counts for abilities whose real number of hits isn't statable from a
 * regex-friendly description phrase (same pattern as CONDITIONAL_COOLDOWNS). Ricochet always
 * lands 3 hits regardless of how many enemies are actually in range -- with only one target, the
 * extra hits just land on it at reduced damage -- which its own description ("up to 2 additional
 * enemies") doesn't state as a hit count; confirmed directly by the user.
 */
export const HIT_COUNT_OVERRIDES: Record<string, number> = {
	Ricochet: 3
};

/**
 * How many times `ability` hits, for purposes like Imbue: Shadows' per-hit adrenaline bonus --
 * layered resolution: a channelled ability's own hit count; else a bare "N hits." phrase in the
 * description (covers simultaneous multi-hit abilities like Adaptive Strike's "2 hits."); else a
 * hand-curated override; else a plain single hit.
 */
export function hitCountFor(ability: Ability): number {
	const profile = parseHitProfile(ability);
	if (profile.kind === 'channel') return profile.hits;

	const bareHitsMatch = ability.description.match(/(\d+)\s*hits?\./i);
	if (bareHitsMatch) return Number(bareHitsMatch[1]);

	return HIT_COUNT_OVERRIDES[ability.name] ?? 1;
}

export const IMBUE_SHADOWS_ADRENALINE_PER_HIT = 5;

/** Every landed-hit tick of `ability`, for resource modifiers (like Imbue: Shadows) that need to
 *  apply once per hit rather than once per placement -- a channelled ability's surviving hit ticks
 *  (per resolveChannels, so an interrupted channel only credits the hits that actually landed), or
 *  else just its own start tick, scaled to hitCountFor(ability) copies for a simultaneous
 *  multi-hit ability (Ricochet's 3, Adaptive Strike's 2, Deadshot's bare "8 hits.") since those
 *  don't have distinct timing to spread across. */
export function hitTicksForPlacement(
	placement: TimelinePlacement,
	ability: Ability,
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number
): number[] {
	const profile = parseHitProfile(ability);
	if (profile.kind === 'channel') {
		const channels = resolveChannels(placements, abilities, timelineLength);
		const channel = channels.find((c) => c.placementId === placement.id);
		return channel?.hitTicks ?? [];
	}
	return Array(hitCountFor(ability)).fill(placement.startTick);
}

export interface AdrenalineState {
	value: number;
	/** True at a spend-placement's tick if the banked adrenaline just before it was less than the
	 *  amount required -- purely informational (see resolveAdrenaline's doc comment), never blocks
	 *  placement. */
	insufficientForCost: boolean;
}

const ADRENALINE_MAX = 100;

/** Ring of Vigour's flat adrenaline refund after an Ultimate ability is used, e.g. a 100%-cost
 *  Ultimate (Berserk) leaves the player at 10%, and a 60%-cost Ultimate (Meteor Strike) leaves them
 *  at 50% -- both match a flat +10 applied after the cost, not 10% of the amount spent. */
export const RING_OF_VIGOUR_REFUND_PERCENT = 10;

export interface PerTickAdrenaline {
	amountPerTick: number;
	intervalTicks: number;
}

/**
 * Parses a flat passive-income clause from a self-buff's description, e.g. Meteor Strike's
 * "Generates 4.5% Adrenaline every 0.6s (1 tick) while you have a Melee weapon equipped." This is
 * distinct from a placement's one-off `ability.adrenaline` gain/cost (applied once, on cast) --
 * this fires on every qualifying tick for as long as the buff (per parseBuffInfo) stays active.
 */
export function parsePerTickAdrenaline(ability: Ability): PerTickAdrenaline | null {
	const match = ability.description.match(
		/generates ([\d.]+)% adrenaline every [\d.]+s \((\d+) ticks?\)/i
	);
	if (!match) return null;
	return { amountPerTick: Number(match[1]), intervalTicks: Number(match[2]) };
}

/**
 * Ring of Vigour: refunds a flat 10 adrenaline immediately after an Ultimate ability's cost
 * resolves -- a passive modifier, always active while the unlock is toggled on (see
 * ModifierContext.ringOfVigourActive), regardless of anything happening on the timeline.
 */
export const RING_OF_VIGOUR_MODIFIER: PassiveModifier = {
	kind: 'passive',
	subject: 'player',
	resourceId: 'adrenaline',
	resourceAspect: 'costRefund',
	effect: { operation: 'add', value: RING_OF_VIGOUR_REFUND_PERCENT },
	source: { label: 'Ring of Vigour' },
	appliesToAbility: (ability) => ability.type === 'Ultimate' && ability.adrenaline < 0,
	isActive: (ctx) => ctx.ringOfVigourActive
};

/**
 * Imbue: Shadows' "Ranged attacks against your target generate 5% Adrenaline with each hit" bonus
 * -- a buff-window modifier active only while its own buff window (per resolveBuffs) covers the
 * current tick. Applies to every Ranged attack that hits the target -- Basics, Enhanced, and
 * Ultimates alike (e.g. Rapid Fire, Deadshot, Shadow Tendrils all qualify) -- NOT just abilities
 * whose own `adrenaline` field happens to be positive (that field reflects the ability's own
 * generate/cost mechanic, which is unrelated to whether it lands a ranged hit; Rapid Fire costs
 * 25% but still lands 8 hits, and Deadshot costs 60% but still lands 8 hits, each independently
 * eligible for this bonus regardless of the ability's own cost/generate sign). `target !== 'Self'`
 * (and `!== 'Varies'`) is this project's existing "does this ability actually hit something"
 * classification, per data/abilities.ts -- confirmed directly against the wiki's own wording,
 * which has no restriction to generating/Basic abilities at all.
 *
 * The effect value is the bonus for ONE landed hit (not pre-scaled by hitCountFor) -- resolveResource
 * applies generateBonus/generateMultiplier once per entry in hitTicksForPlacement, so a multi-hit
 * ability naturally accumulates hitCountFor(ability) copies of this bonus, one per hit tick, instead
 * of one lump sum at the placement's start tick.
 */
export const IMBUE_SHADOWS_ADRENALINE_MODIFIER: BuffWindowModifier = {
	kind: 'buffWindow',
	subject: 'player',
	resourceId: 'adrenaline',
	resourceAspect: 'generateBonus',
	buffAbilityName: 'Imbue: Shadows',
	effect: { operation: 'add', value: IMBUE_SHADOWS_ADRENALINE_PER_HIT },
	source: { label: 'Imbue: Shadows' },
	appliesToAbility: (ability) => ability.target !== 'Self' && ability.target !== 'Varies',
	requiresContext: (ctx) => ctx.combatStyle === 'ranged',
	applicationGranularity: 'perHit'
};

/** Meteor Strike's own passive income while its buff window is active -- an ambient buff-window
 *  modifier, applied once per tick regardless of whether anything is placed on that tick. Per
 *  `isResourceModifierActive`, `perTickIncome` specifically doesn't fire until the tick AFTER
 *  activation (confirmed against a real sequence: Meteor Strike's own cast lands at 100 -> 50, with
 *  no +4.5 yet that same tick -- the first +4.5 lands the following tick). */
export const METEOR_STRIKE_ADRENALINE_MODIFIER: BuffWindowModifier = {
	kind: 'buffWindow',
	subject: 'player',
	resourceId: 'adrenaline',
	resourceAspect: 'perTickIncome',
	buffAbilityName: 'Meteor Strike',
	effect: { operation: 'add', value: 4.5 },
	intervalTicks: 1,
	source: { label: 'Meteor Strike' }
};

/** Meteor Strike's own text: "Melee basic abilities generate 1.5x Adrenaline" while its buff window
 *  is active -- unlike perTickIncome, this applies starting on Meteor Strike's own activation tick
 *  (a melee Basic used that same tick is boosted too, if one somehow landed there). */
export const METEOR_STRIKE_BASIC_ADRENALINE_MULTIPLIER = 1.5;

export const METEOR_STRIKE_BASIC_MULTIPLIER_MODIFIER: BuffWindowModifier = {
	kind: 'buffWindow',
	subject: 'player',
	resourceId: 'adrenaline',
	resourceAspect: 'generateMultiplier',
	buffAbilityName: 'Meteor Strike',
	effect: { operation: 'multiply', value: METEOR_STRIKE_BASIC_ADRENALINE_MULTIPLIER },
	appliesToAbility: (ability) => ability.type === 'Basic' && ability.style === 'melee',
	source: { label: 'Meteor Strike' }
};

/** Fury of the Small: every ability that generates adrenaline generates 1 additional flat
 *  adrenaline -- a `generateBonus`, so it stacks additively with Imbue: Shadows before any
 *  multiplier (e.g. Meteor Strike's 1.5x) applies on top, same as `resolveResource`'s existing
 *  `(base + bonus.additive) * multiplier` order: Adaptive Strike (12) -> 13 normally, or 13 * 1.5 =
 *  19.5 while Meteor Strike's buff is active -- both confirmed directly by the user. */
export const FURY_OF_THE_SMALL_BONUS = 1;

export const FURY_OF_THE_SMALL_MODIFIER: PassiveModifier = {
	kind: 'passive',
	subject: 'player',
	resourceId: 'adrenaline',
	resourceAspect: 'generateBonus',
	effect: { operation: 'add', value: FURY_OF_THE_SMALL_BONUS },
	source: { label: 'Fury of the Small' },
	appliesToAbility: (ability) => ability.adrenaline > 0,
	isActive: (ctx) => ctx.furyOfTheSmallActive
};

const ADRENALINE_MODIFIERS: Modifier[] = [
	RING_OF_VIGOUR_MODIFIER,
	IMBUE_SHADOWS_ADRENALINE_MODIFIER,
	METEOR_STRIKE_ADRENALINE_MODIFIER,
	METEOR_STRIKE_BASIC_MULTIPLIER_MODIFIER,
	FURY_OF_THE_SMALL_MODIFIER
];

const ADRENALINE_DEFINITION: Omit<ResourceDefinition, 'hitTicksForPlacement'> = {
	id: 'adrenaline',
	baseCap: ADRENALINE_MAX,
	startingValue: 0,
	generationGranularity: 'perPlacement',
	generateForPlacement: (ability) => ability.adrenaline
};

/**
 * Simulates the adrenaline gauge across the whole timeline via the generic resource engine (see
 * resources.ts) -- starts at `startingAdrenaline`, and applies Ring of Vigour, Imbue: Shadows,
 * Meteor Strike's passive income/generation boost, and Fury of the Small's flat +1 generation as
 * Modifier objects rather than ad hoc checks. 120%+ support is explicitly deferred (clamped to
 * [0, 100]). A spend attempted without enough banked adrenaline still applies and clamps at 0 --
 * flagged via `insufficientForCost`, never blocked.
 */
export function resolveAdrenaline(
	placements: TimelinePlacement[],
	abilities: Ability[],
	combatStyle: CombatStyle | null,
	startingAdrenaline: number,
	timelineLength: number,
	ringOfVigourActive = false,
	furyOfTheSmallActive = false
): AdrenalineState[] {
	const buffs = resolveBuffs(placements, abilities, timelineLength);
	const ctx: ModifierContext = { combatStyle, ringOfVigourActive, furyOfTheSmallActive };
	const definition: ResourceDefinition = {
		...ADRENALINE_DEFINITION,
		startingValue: startingAdrenaline,
		hitTicksForPlacement: (placement, ability) =>
			hitTicksForPlacement(placement, ability, placements, abilities, timelineLength)
	};
	return resolveResource(
		definition,
		placements,
		abilities,
		ADRENALINE_MODIFIERS,
		buffs,
		ctx,
		timelineLength
	).map(({ value, insufficientForCost }) => ({ value, insufficientForCost }));
}

export const BLOODLUST_BASE_CAP = 4;
export const BLOODLUST_BERSERK_CAP = 8;
export const BERSERK_BASIC_MULTIPLIER = 2;

/** Parses "Generates N Bloodlust stack(s)." from an ability's description; 0 if absent. */
export function parseBloodlustGenerate(ability: Ability): number {
	const match = ability.description.match(/generates (\d+) bloodlust stacks?\./i);
	return match ? Number(match[1]) : 0;
}

/** Parses the conditional "Bloodlust (consumes N Bloodlust stacks)" bonus-effect trigger from an
 *  ability's description; 0 if absent. */
export function parseBloodlustConsume(ability: Ability): number {
	const match = ability.description.match(/bloodlust \(consumes (\d+) bloodlust stacks?\)/i);
	return match ? Number(match[1]) : 0;
}

/** Berserk raises Bloodlust's cap from 4 to 8 while its buff window is active. */
export const BERSERK_BLOODLUST_CAP_MODIFIER: BuffWindowModifier = {
	kind: 'buffWindow',
	subject: 'player',
	resourceId: 'bloodlust',
	resourceAspect: 'cap',
	buffAbilityName: 'Berserk',
	effect: { operation: 'override', value: BLOODLUST_BERSERK_CAP },
	source: { label: 'Berserk' }
};

/** Berserk doubles Bloodlust generation from Basic abilities while its buff window is active. */
export const BERSERK_BASIC_MULTIPLIER_MODIFIER: BuffWindowModifier = {
	kind: 'buffWindow',
	subject: 'player',
	resourceId: 'bloodlust',
	resourceAspect: 'generateMultiplier',
	buffAbilityName: 'Berserk',
	effect: { operation: 'multiply', value: BERSERK_BASIC_MULTIPLIER },
	appliesToAbility: (ability) => ability.type === 'Basic',
	source: { label: 'Berserk' }
};

const BLOODLUST_MODIFIERS: Modifier[] = [
	BERSERK_BLOODLUST_CAP_MODIFIER,
	BERSERK_BASIC_MULTIPLIER_MODIFIER
];

const BLOODLUST_DEFINITION: ResourceDefinition = {
	id: 'bloodlust',
	baseCap: BLOODLUST_BASE_CAP,
	startingValue: 0,
	generationGranularity: 'perPlacement',
	generateForPlacement: parseBloodlustGenerate,
	consumeForPlacement: parseBloodlustConsume,
	isEligiblePlacement: (ability) => ability.style === 'melee'
};

/**
 * Simulates Bloodlust stacks across the timeline via the generic resource engine (see
 * resources.ts) -- a melee-only resource (non-melee placements are simply ineligible, value holds
 * steady), starting at 0 (no starting-stacks config exists, unlike adrenaline). Berserk's cap raise
 * and 2x Basic generation are Modifier objects rather than ad hoc checks. A placement's "consumes N
 * stacks" bonus effect only fires if at least N are currently banked -- otherwise it's simply
 * skipped, same permissive spirit as everywhere else in this file.
 */
export function resolveBloodlust(
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number
): ResourceState[] {
	const buffs = resolveBuffs(placements, abilities, timelineLength);
	const ctx: ModifierContext = {
		combatStyle: null,
		ringOfVigourActive: false,
		furyOfTheSmallActive: false
	};
	return resolveResource(
		BLOODLUST_DEFINITION,
		placements,
		abilities,
		BLOODLUST_MODIFIERS,
		buffs,
		ctx,
		timelineLength
	);
}
