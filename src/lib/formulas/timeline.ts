/**
 * Rotation timeline: ticks, Global Cooldown, and per-placement damage resolution.
 */
import type { Ability, Enemy } from '../data/abilities';
import type { CombatStyle } from './abilityDamage';
import {
	DEFAULT_TICK_CONTEXT,
	NO_GEAR_CONTEXT,
	type GearContext,
	type TickContext
} from './context';
import type {
	BuffEmission,
	BuffWindowModifier,
	Modifier,
	NumericEffect,
	PassiveModifier
} from './modifiers';
import { resolveResource, type ResourceDefinition, type ResourceState } from './resources';

export type { GearContext, GlobalContext, TickContext } from './context';

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

/** Default enemy assumption for callers that don't care about HP-gated damage (e.g. tests/call
 *  sites unrelated to Punish) -- full health, matching what "no assumption entered yet" should
 *  mean in the UI too. */
export const DEFAULT_ENEMY: Enemy = { hpPercent: 100 };

/**
 * A small set of abilities (15 of 142, e.g. Dive, Bladed Dive, Surge, quiver ammo swaps, High
 * Alchemy) can be used without triggering the Global Cooldown, per their own wiki description --
 * there's no structural field for this in abilities.ts, so it's derived from the description text
 * rather than hand-annotating every entry.
 */
export function isOffGcdAbility(ability: Ability): boolean {
	if (ability.offGcd !== undefined) return ability.offGcd;
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
 * Picks the right entry of a damageVariants/hitCountVariants-shaped dictionary for the player's
 * current gear. Matches two-handed/dual-wield/main-hand-only wording against the weapon config,
 * and named igneous-cape variants against the equipped cape; otherwise falls back to the "Any" key
 * (or the first key if no "Any" exists). Variants gated on a full equipment *set* (e.g. "4+ pieces
 * of Tumeken's resplendence equipment") are left on their fallback value -- this app has no
 * "equipped set" concept anywhere else either, so resolving those precisely is out of scope for
 * now (same kind of documented simplification as the unverified Magic styleTier value elsewhere in
 * this codebase). Shared by resolveDamagePercent and resolveHitCountVariant so the two stay
 * consistent -- an ability's igneous cape damage bump and hit-count bump are always keyed by the
 * exact same gear match.
 */
function resolveGearVariant<T>(variants: Record<string, T>, gear: GearContext): T {
	const entries = Object.entries(variants);
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

/** Picks the ability's damage percent for the player's current gear, global context, and assumed
 *  enemy state, normalized to a plain string so every downstream consumer (parseDamageMultiplier)
 *  only ever handles one shape. Resolution order (see docs/ability-resolver-design.md):
 *    1. `ability.resolve`'s `damagePercent` output, if the ability declares a resolver AND it
 *       actually returns one (a resolver that only overrides e.g. `hitOffsets` falls through).
 *    2. The ability's own static `damagePercent` (a raw `number` becomes `"<value>%"`; the legacy
 *       enemy-only function form from before `resolve` existed is still honored here too).
 *    3. `damageVariants`, gear-matched via the legacy `resolveGearVariant` prose-string matcher.
 *  `gear`/`enemy`/`ctx` each default to a neutral/empty value for callers that don't care. */
export function resolveDamagePercent(
	ability: Ability,
	gear: GearContext,
	enemy: Enemy = DEFAULT_ENEMY,
	ctx: TickContext = DEFAULT_TICK_CONTEXT
): string | null {
	const resolved = ability.resolve?.({ ctx, gear, enemy })?.damagePercent;
	const raw =
		resolved !== undefined
			? resolved
			: ability.damagePercent !== null
				? ability.damagePercent
				: ability.damageVariants
					? resolveGearVariant(ability.damageVariants, gear)
					: null;
	if (raw === null) return null;
	const value = typeof raw === 'function' ? raw(enemy) : raw;
	return typeof value === 'number' ? `${value}%` : value;
}

/** Picks the right hitCountVariants entry for the player's current gear (e.g. Deadshot: 4 hits
 *  normally, 8 with Igneous Kal-Xil/Kal-Zuk) -- see resolveGearVariant. null if the ability has no
 *  gear-dependent hit count. Legacy fallback tier -- see resolveHitOffsets, which supersedes this
 *  for a migrated ability. */
export function resolveHitCountVariant(ability: Ability, gear: GearContext): number | null {
	if (!ability.hitCountVariants) return null;
	return resolveGearVariant(ability.hitCountVariants, gear);
}

/** Resolves `ability.damagesOnTick` for the player's current gear -- either the flat array
 *  directly (gear-invariant timing, e.g. Ricochet), or the right entry of a gear-variant
 *  dictionary keyed like damageVariants/hitCountVariants (e.g. Adaptive Strike: one hit for
 *  2h/main-hand-only, two simultaneous hits for dual wield). null if unset. Legacy fallback tier --
 *  see resolveHitOffsets, which supersedes this for a migrated ability. */
export function resolveDamagesOnTick(ability: Ability, gear: GearContext): number[] | null {
	if (!ability.damagesOnTick) return null;
	if (Array.isArray(ability.damagesOnTick)) return ability.damagesOnTick;
	return resolveGearVariant(ability.damagesOnTick, gear);
}

/**
 * The tick offset of every hit `ability` lands, one entry per hit -- e.g. `[0]` for a plain single
 * hit, `[0, 1, 1]` for Ricochet, `[0, 3, 6, 9, 12, 15]` for Slaughter. Supersedes `hitCountFor` +
 * `parseHitProfile`'s channel case + `resolveDamagesOnTick` for a migrated ability: hit COUNT is
 * just the returned array's `.length`, not a separate concept. Resolution order (see
 * docs/ability-resolver-design.md):
 *   1. `ability.resolve`'s `hitOffsets` output, if present.
 *   2. The ability's own static `hitOffsets` field, if set.
 *   3. Legacy fallback: `hitCountVariants` (gear) -> a channel `hitProfile`'s evenly-spaced hits ->
 *      `resolveDamagesOnTick` -> a bare "N hits." description match -> `HIT_COUNT_OVERRIDES` -> 1.
 */
export function resolveHitOffsets(
	ability: Ability,
	gear: GearContext,
	enemy: Enemy = DEFAULT_ENEMY,
	ctx: TickContext = DEFAULT_TICK_CONTEXT
): number[] {
	const resolved = ability.resolve?.({ ctx, gear, enemy })?.hitOffsets;
	if (resolved !== undefined) return resolved;
	if (ability.hitOffsets !== undefined) return ability.hitOffsets;

	// Legacy fallback chain -- unchanged behavior for every not-yet-migrated ability. A channel's
	// hits are evenly spaced by its own intervalTicks; damagesOnTick's explicit array wins over a
	// same-tick assumption; otherwise every hit from hitCountFor's own legacy chain lands
	// simultaneously (offset 0), matching this app's behavior before hitOffsets existed.
	const profile = parseHitProfile(ability);
	if (profile.kind === 'channel') {
		const hits = resolveHitCountVariant(ability, gear) ?? profile.hits;
		return Array.from({ length: hits }, (_, i) => i * profile.intervalTicks);
	}

	const onTick = resolveDamagesOnTick(ability, gear);
	if (onTick) return onTick;

	return Array.from({ length: hitCountFor(ability, gear) }, () => 0);
}

/** Whether `ability`'s hits are an unconditional bleed/DoT -- see resolveChannels for how this
 *  affects interruption. Resolution order: `ability.resolve`'s `isBleed` output, then the
 *  ability's own static `isBleed` field, then BLEED_ABILITY_NAMES (the legacy hand-curated set). */
export function resolveIsBleed(
	ability: Ability,
	gear: GearContext = NO_GEAR_CONTEXT,
	enemy: Enemy = DEFAULT_ENEMY,
	ctx: TickContext = DEFAULT_TICK_CONTEXT
): boolean {
	const resolved = ability.resolve?.({ ctx, gear, enemy })?.isBleed;
	if (resolved !== undefined) return resolved;
	if (ability.isBleed !== undefined) return ability.isBleed;
	return BLEED_ABILITY_NAMES.has(ability.name);
}

/** Computes the damage a single placed ability deals, given the player's current total Ability
 *  Damage (AD) figure, gear (for damageVariants resolution), assumed enemy state (for an HP-gated
 *  `damagePercent`, e.g. Punish), and global context (for a `resolve`d damagePercent depending on
 *  e.g. an equipped set -- Asphyxiate). `enemy`/`ctx` default to neutral values. */
export function abilityDamageForPlacement(
	ability: Ability,
	adTotal: number,
	gear: GearContext,
	enemy: Enemy = DEFAULT_ENEMY,
	ctx: TickContext = DEFAULT_TICK_CONTEXT
): number {
	const raw = resolveDamagePercent(ability, gear, enemy, ctx);
	const multiplier = parseDamageMultiplier(raw);
	return multiplier === null ? 0 : Math.floor(adTotal * multiplier);
}

/** Whether `ability` actually deals damage at all, for gating effects like Greater Fury's
 *  crit-consumption or Greater Barge's out-of-combat timer -- NOT simply
 *  `resolveDamagePercent(...) !== null`, since a non-damaging ability's damagePercent is often the
 *  literal string `'N/A'` rather than `null` (e.g. Surge) -- `parseDamageMultiplier` is what
 *  actually recognizes that as "no damage", same check `abilityDamageForPlacement` already relies
 *  on to zero those out. `enemy`/`ctx` default to neutral values -- irrelevant for this check in
 *  practice, since every current context-dependent ability (Punish, Asphyxiate) deals damage
 *  regardless of context, only the AMOUNT varies. */
export function abilityDealsDamage(
	ability: Ability,
	gear: GearContext,
	enemy: Enemy = DEFAULT_ENEMY,
	ctx: TickContext = DEFAULT_TICK_CONTEXT
): boolean {
	return parseDamageMultiplier(resolveDamagePercent(ability, gear, enemy, ctx)) !== null;
}

export function placementAbility(
	placement: TimelinePlacement,
	abilities: Ability[]
): Ability | null {
	return abilities.find((a) => a.name === placement.abilityName) ?? null;
}

/**
 * Hand-curated set of abilities whose multi-hit damage is a genuine bleed/damage-over-time effect
 * rather than an interruptible channel -- e.g. Dismember, Slaughter, Massacre. Unlike a channel
 * (Assault, Rapid Fire, ...), placing another ability afterward does NOT cut a bleed short; it
 * always deals its full damage over its full natural duration regardless of what's placed after it
 * -- the same non-interruptible behavior Greater Barge's Endless Assault conversion grants a
 * channelled ability (see resolveEndlessAssaultBleeds), except these abilities are bleeds
 * unconditionally, with no Greater Barge or any other trigger needed. Same curation pattern as
 * CONDITIONAL_COOLDOWNS/HIT_COUNT_OVERRIDES: named by the user directly rather than parsed from
 * description text, so add more entries here as they come up.
 */
export const BLEED_ABILITY_NAMES: ReadonlySet<string> = new Set(['Dismember', 'Slaughter', 'Massacre']);

/**
 * How many times a placed ability actually hits, and when:
 * - 'single': one hit, on the start tick (the default -- most abilities, and also abilities whose
 *   description mentions a bare "N hits" with no timing, e.g. Adaptive Strike -- see note below).
 * - 'channel': N hits spread over time at a fixed interval, e.g. Assault ("Attack 4 times over
 *   4.2s (7 ticks)" -> hits at 0/2/4/6). `isBleed` is true for BLEED_ABILITY_NAMES entries --
 *   these are never truncated by a later placement (see resolveChannels), unlike an ordinary
 *   channel.
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
	| { kind: 'single' }
	| { kind: 'channel'; hits: number; intervalTicks: number; isBleed: boolean };

/**
 * Parses the ability's channel/DoT hit timing from its description text. Two phrasings appear in
 * the data, both verified consistently worded via a full-file grep:
 *   1. "Attack N times over X.Xs (Y ticks)" -- total window given; interval = round((Y-1)/(N-1)).
 *   2. "... per hit every X.Xs (Y ticks) ... N hits." -- interval given directly as Y.
 * Everything else (including a bare "N hits." with no timing, e.g. Adaptive Strike) is 'single'.
 */
export function parseHitProfile(ability: Ability): HitProfile {
	if (ability.hitProfile !== undefined) return ability.hitProfile;

	const isBleed = BLEED_ABILITY_NAMES.has(ability.name);

	const windowMatch = ability.description.match(
		/attack (\d+) times over [\d.]+s \((\d+) ticks?\)/i
	);
	if (windowMatch) {
		const hits = Number(windowMatch[1]);
		const windowTicks = Number(windowMatch[2]);
		if (hits > 1) {
			const intervalTicks = Math.round((windowTicks - 1) / (hits - 1));
			return { kind: 'channel', hits, intervalTicks, isBleed };
		}
	}

	const everyMatch = ability.description.match(/every [\d.]+s \((\d+) ticks?\)/i);
	const hitsMatch = ability.description.match(/(\d+)\s*hits?\.?/i);
	if (everyMatch && hitsMatch) {
		const intervalTicks = Number(everyMatch[1]);
		const hits = Number(hitsMatch[1]);
		if (hits > 1) return { kind: 'channel', hits, intervalTicks, isBleed };
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
	if (ability.buffProfile !== undefined) return ability.buffProfile;

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
	/** True for an unconditional bleed ability (BLEED_ABILITY_NAMES, e.g. Dismember/Slaughter/
	 *  Massacre) OR a channel Greater Barge's Endless Assault converted into one (see
	 *  resolveEndlessAssaultBleeds) -- purely descriptive for the UI (different styling/label);
	 *  the actual bypass of interruption for both cases happens below, inside this function. */
	isBleed: boolean;
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
 *
 * Two independent ways a placement is exempted from that interruption entirely, always dealing its
 * full natural damage over its full natural duration regardless of what's placed after it:
 *   1. `parseHitProfile(ability).isBleed` -- an unconditional bleed (BLEED_ABILITY_NAMES), true
 *      for every placement of that ability regardless of context.
 *   2. `bleedPlacementIds` -- Greater Barge's Endless Assault conversion (see
 *      resolveEndlessAssaultBleeds), which applies only to the ONE specific placement that
 *      consumed the buff, not every placement of that ability.
 */
export function resolveChannels(
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	bleedPlacementIds: ReadonlySet<string> = new Set()
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

		const isBleed = profile.isBleed || bleedPlacementIds.has(placement.id);
		const nextGcd = gcdPlacements.find((p) => p.startTick > placement.startTick);
		const cutoffTick = isBleed ? Infinity : (nextGcd?.startTick ?? Infinity);

		const hitTicks = naturalHitTicks.filter((t) => t < cutoffTick);
		const naturalEnd = naturalHitTicks[naturalHitTicks.length - 1] + 1;
		const barEndTick = Math.min(naturalEnd, cutoffTick, timelineLength);

		result.push({
			placementId: placement.id,
			abilityName: placement.abilityName,
			startTick: placement.startTick,
			hitTicks,
			barEndTick,
			isBleed
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
	if (ability.buffExtension !== undefined) return ability.buffExtension;

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

export const VESTMENTS_OF_HAVOC_SET_NAME = 'Vestments of havoc armour';
export const HAVOC_BUFF_NAME = 'Havoc';
export const HAVOC_DURATION_TICKS = 30; // 18s
export const HAVOC_REGEN_PERCENT = 15;
export const HAVOC_INSTANT_BURST_PERCENT = 20;

/** True for a melee Ultimate ability -- the trigger condition for the Vestments of havoc set's
 *  "Herald of Chaos" 2-piece bonus (any melee ultimate, not one specific named ability, unlike
 *  every other buff this app models). Still used to build HAVOC_EMISSION's ability list below and
 *  by the pre-existing bespoke resolveHavocBuffs. */
export function isMeleeUltimate(ability: Ability): boolean {
	return ability.style === 'melee' && ability.type === 'Ultimate';
}

/**
 * NOT YET WIRED IN -- a worked example of what Havoc looks like as a real `BuffEmission` value,
 * for review before every melee Ultimate's own Ability entry actually references it via `emits`
 * and resolveEmittedBuffs replaces resolveHavocBuffs below. This is the literal object the engine
 * would consume; nothing reads it yet.
 *
 * Havoc isn't owned by one specific ability, but `BuffEmission.trigger` is always 'self' -- there
 * is no "any ability matching a predicate" runtime trigger. Instead, this ONE object (shared
 * reference, not copied) would be pushed onto the `emits` array of every melee Ultimate ability's
 * own Ability entry (Overpower, Pulverise, Berserk, Meteor Strike -- see `isMeleeUltimate`), so
 * `resolveEmittedBuffs`' ordinary "did this placement's own ability declare this emission" check
 * matches any of them alike. Which abilities carry it is a fact about the DATA (who references the
 * object), not a function evaluated per placement.
 */
export const HAVOC_EMISSION: BuffEmission = {
	buffName: 'Havoc',
	subject: 'player',
	trigger: 'self',
	// Evaluated once per resolution against the player's current gear (TickContext), not per
	// placement -- "at least 2 pieces of Vestments of havoc armour equipped."
	gearCondition: (ctx) => (ctx.setPieceCounts[VESTMENTS_OF_HAVOC_SET_NAME] ?? 0) >= 2,
	durationTicks: HAVOC_DURATION_TICKS, // 30 ticks (18s)
	// Re-triggering (another melee ultimate cast while Havoc is already up) does NOT restart the
	// window -- it bursts instead: end the current instance early and grant a one-off effect.
	reTriggerBehavior: 'burst',
	reTriggerEffect: {
		resourceId: 'adrenaline',
		operation: 'add',
		value: HAVOC_INSTANT_BURST_PERCENT // flat +20% adrenaline, once, at the burst tick
	}
	// No `consumedBy` -- Havoc isn't ended by a damaging hit the way Greater Fury/Chaos Roar are.
	// Its steady-state 15%-over-30-ticks regen is a separate concern, already handled by the
	// existing HAVOC_REGEN_MODIFIER (a BuffWindowModifier reading this same buff's window) --
	// BuffEmission only describes when the buff EXISTS, not every resource effect tied to it.
};

/** One instant adrenaline burst produced by re-triggering Havoc while it's already active (see
 *  resolveHavocBuffs) -- consumed by resolveAdrenaline via costRefundForPlacement, keyed on the
 *  exact placement that caused the re-trigger (not just its tick, since that's the only way to
 *  disambiguate this specific melee-ultimate cast from any other placement that happens to share
 *  its tick). */
export interface HavocInstantBurst {
	placementId: string;
	tick: number;
	percent: number;
}

export interface HavocResolution {
	buffs: ResolvedBuff[];
	instantBursts: HavocInstantBurst[];
}

/**
 * Resolves the Vestments of havoc set's "Herald of Chaos" 2-piece bonus: casting a melee ultimate
 * while at least 2 pieces are worn starts an 18s (30-tick) "Havoc" buff granting 15% adrenaline
 * regenerated evenly over its duration. Casting ANOTHER qualifying ultimate while Havoc is already
 * active does NOT start a second window or extend the first -- per the wiki ("If this effect is
 * already active, instead regenerate 20% adrenaline instantly, ending the regeneration effect"),
 * it immediately grants a flat 20% adrenaline burst and ends the buff early, right there. This is
 * a genuinely different shape from every other buff in this file (resolveBuffs): it's triggered by
 * an ability CATEGORY (any melee ultimate) rather than one specific named ability, and its own
 * re-trigger behavior depends on whether an instance is already running -- so it's resolved
 * separately here rather than folded into parseBuffInfo/resolveBuffs, then merged into the same
 * ResolvedBuff[] shape those consume (packIntoLanes, the Timeline buff lane, etc. all work
 * unchanged since they only care about {startTick, endTick, abilityName, placementId}).
 */
export function resolveHavocBuffs(
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	setPieceCounts: Record<string, number>
): HavocResolution {
	const buffs: ResolvedBuff[] = [];
	const instantBursts: HavocInstantBurst[] = [];

	if ((setPieceCounts[VESTMENTS_OF_HAVOC_SET_NAME] ?? 0) < 2) {
		return { buffs, instantBursts };
	}

	const triggers = placements
		.filter((p) => {
			const ability = placementAbility(p, abilities);
			return ability && isMeleeUltimate(ability);
		})
		.sort((a, b) => a.startTick - b.startTick);

	let active: ResolvedBuff | null = null;
	let instanceCounter = 0;
	for (const placement of triggers) {
		if (active && placement.startTick < active.endTick) {
			// Re-triggered while still active: instant burst, ends the window right here instead
			// of extending or stacking a second one.
			active.endTick = placement.startTick;
			instantBursts.push({
				placementId: placement.id,
				tick: placement.startTick,
				percent: HAVOC_INSTANT_BURST_PERCENT
			});
			active = null;
			continue;
		}
		instanceCounter++;
		active = {
			placementId: `havoc-${instanceCounter}`,
			abilityName: HAVOC_BUFF_NAME,
			startTick: placement.startTick,
			endTick: Math.min(placement.startTick + HAVOC_DURATION_TICKS, timelineLength),
			extensions: []
		};
		buffs.push(active);
	}

	return { buffs, instantBursts };
}

export const VESTMENTS_OF_HAVOC_3PC_BERSERK_EXTEND_TICKS = 10; // +6s, 20.4s -> 26.4s

/**
 * Applies Vestments of havoc's 3-piece bonus directly to an already-resolved Berserk buff: "+6
 * seconds" (10 ticks) to its duration, straight onto its endTick. Unlike every other duration
 * extension in this file (parseBuffExtension/resolveBuffs), this one isn't triggered by casting
 * some OTHER ability -- it's an unconditional property of Berserk itself while 3+ pieces are worn.
 * Still recorded as a proper `AppliedBuffExtension` (source "Vestments of havoc (3pc)"), same as
 * any other extension, so it renders identically on the buff bar (groupBuffExtensions/Timeline.svelte)
 * instead of just silently widening the bar with no visible cause. Mutates nothing -- returns a new
 * array with Berserk's entries adjusted.
 */
export function applyVestmentsBerserkExtension(
	buffs: ResolvedBuff[],
	setPieceCounts: Record<string, number>,
	timelineLength: number
): ResolvedBuff[] {
	if ((setPieceCounts[VESTMENTS_OF_HAVOC_SET_NAME] ?? 0) < 3) return buffs;
	return buffs.map((buff) => {
		if (buff.abilityName !== 'Berserk') return buff;
		const extendTicks = Math.min(
			VESTMENTS_OF_HAVOC_3PC_BERSERK_EXTEND_TICKS,
			timelineLength - buff.endTick
		);
		if (extendTicks <= 0) return buff;
		return {
			...buff,
			endTick: buff.endTick + extendTicks,
			extensions: [
				...buff.extensions,
				{
					tick: buff.startTick,
					extendTicks,
					sourceAbilityName: 'Vestments of havoc (3pc)'
				}
			]
		};
	});
}

export const GREATER_FURY_BUFF_NAME = 'Greater Fury';
export const GREATER_FURY_DURATION_TICKS = 25; // 15s
export const GREATER_FURY_CRIT_MULTIPLIER = 1.5;

/**
 * Resolves Greater Fury's own status effect: casting it starts a "Greater Fury" buff lasting 25
 * ticks (15s), consumed by the next damage-dealing Melee ability the player uses (per the wiki:
 * "Removed after dealing a critical strike" -- since this app has no crit-chance model, the
 * simplification is that the very next damaging ability always consumes it and always crits, per
 * the user's direction). A non-damaging placement (a self-buff, a bare positioning move, etc.)
 * neither consumes nor is boosted by it -- only placements `abilityDealsDamage` recognizes as
 * actually dealing damage count.
 * Re-casting Greater Fury while a previous instance is still unconsumed simply starts a fresh
 * 25-tick window from that later cast (replacing the old one, same as any other self-buff
 * re-cast in this app -- there's no stacking concept for it).
 *
 * Returns both the synthetic buff windows (for the same buff lane/rendering every other buff
 * uses) and the set of placement ids that actually consumed one -- the latter drives
 * `damageByTick`'s crit multiplier, since only that ONE specific placement (not every damaging
 * ability while the buff happens to be up) gets boosted.
 */
export function resolveGreaterFuryBuffs(
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	gear: GearContext
): { buffs: ResolvedBuff[]; critPlacementIds: Set<string> } {
	const buffs: ResolvedBuff[] = [];
	const critPlacementIds = new Set<string>();

	const sorted = [...placements].sort((a, b) => a.startTick - b.startTick);

	let active: ResolvedBuff | null = null;
	let instanceCounter = 0;
	for (const placement of sorted) {
		const ability = placementAbility(placement, abilities);
		if (!ability) continue;

		if (active && placement.startTick < active.endTick) {
			if (abilityDealsDamage(ability, gear)) {
				critPlacementIds.add(placement.id);
				active.endTick = placement.startTick;
				active = null;
				continue;
			}
		}

		if (ability.name === GREATER_FURY_BUFF_NAME) {
			instanceCounter++;
			active = {
				placementId: `greater-fury-${instanceCounter}`,
				abilityName: GREATER_FURY_BUFF_NAME,
				startTick: placement.startTick,
				endTick: Math.min(placement.startTick + GREATER_FURY_DURATION_TICKS, timelineLength),
				extensions: []
			};
			buffs.push(active);
		}
	}

	return { buffs, critPlacementIds };
}

/** One placement that consumed an emitted buff's `consumedBy` clause -- the generic analogue of
 *  resolveGreaterFuryBuffs' `critPlacementIds`, generalized to carry the consuming emission's own
 *  effect/appliesToHits instead of a hardcoded 1.5x. `damageByTick` reads this the same way it
 *  already reads `critPlacementIds`/`bonusPlacementIds`, just keyed by buffName so multiple
 *  different emissions' consumptions can coexist in one pass. */
export interface EmittedBuffConsumption {
	placementId: string;
	buffName: string;
	effect: NumericEffect;
	appliesToHits: 'all' | 'first';
}

/**
 * The generic engine every BuffEmission is interpreted by -- the data-driven replacement for a
 * bespoke per-effect resolver (resolveGreaterFuryBuffs, resolveChaosRoarBuffs, ...): reads every
 * `ability.emits` entry off every ability in `abilities`, and produces the same ResolvedBuff[]
 * shape every other buff in this app renders through (packIntoLanes, the Timeline buff lane,
 * resolveAspect via BuffWindowModifier, ...).
 *
 * One instance is tracked per DISTINCT buffName at a time (matching how every existing bespoke
 * resolver already behaves: Greater Fury, Chaos Roar, Berserk, Havoc are each a single outstanding
 * window, never stacked). `trigger: 'self'` matches a placement whose OWN ability declared this
 * emission -- an emission shared across several abilities (Havoc, Gloves of Passage) is the SAME
 * object referenced from each of those abilities' own `emits` arrays (see BuffEmission's doc
 * comment), so this one check naturally fires for any of them.
 */
export function resolveEmittedBuffs(
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	gear: GearContext,
	ctx: TickContext
): { buffs: ResolvedBuff[]; consumptions: EmittedBuffConsumption[] } {
	const buffs: ResolvedBuff[] = [];
	const consumptions: EmittedBuffConsumption[] = [];

	const sorted = [...placements].sort((a, b) => a.startTick - b.startTick);

	// Every DISTINCT emission declared on any ability, computed once up front -- consumption has to
	// be checked against every currently-active emission on every placement, not just the emissions
	// the current placement's own ability happens to declare (a Greater Fury buff started by
	// casting Greater Fury is consumed by a LATER placement -- e.g. Rend -- whose own `emits` list
	// has nothing to do with Greater Fury at all). Deduplicated by object identity: an emission
	// shared across several abilities (Havoc referenced from every melee ultimate's own `emits`)
	// would otherwise appear once per ability that references it, and get processed redundantly
	// that many times per placement.
	const allEmissions: BuffEmission[] = [];
	for (const a of abilities) {
		if (!a.emits) continue;
		for (const emission of a.emits) {
			if (!allEmissions.includes(emission)) allEmissions.push(emission);
		}
	}

	// One active-instance slot + instance counter per distinct buffName, so Greater Fury and Havoc
	// (say) don't interfere with each other's "one outstanding instance" bookkeeping.
	const activeByName = new Map<string, ResolvedBuff | null>();
	const instanceCounterByName = new Map<string, number>();

	for (const placement of sorted) {
		const ability = placementAbility(placement, abilities);
		if (!ability) continue;

		for (const emission of allEmissions) {
			const active = activeByName.get(emission.buffName) ?? null;

			// Consumption check first: an already-active instance of THIS emission's buff ends the
			// moment a matching placement lands, regardless of whether that same placement is also
			// what re-triggers a fresh instance (mirrors every existing bespoke resolver: the
			// consuming hit and a subsequent re-cast are mutually exclusive per placement anyway,
			// since a damaging attack and a self-cast utility are never the same ability here).
			if (active && placement.startTick < active.endTick && emission.consumedBy) {
				const matches = emission.consumedBy.matches ?? ((a: Ability) => abilityDealsDamage(a, gear));
				if (matches(ability)) {
					consumptions.push({
						placementId: placement.id,
						buffName: emission.buffName,
						effect: emission.consumedBy.effect,
						appliesToHits: emission.consumedBy.appliesToHits ?? 'all'
					});
					active.endTick = placement.startTick;
					activeByName.set(emission.buffName, null);
					continue;
				}
			}

			// Trigger check: does THIS placement start/re-trigger this emission at all? Matches a
			// placement whose OWN ability declared this exact emission object (reference equality
			// against its own `emits` array is safe -- allEmissions was built by spreading, not
			// cloning, so the object identity is preserved). An emission shared across several
			// abilities (Havoc, Gloves of Passage) is referenced from each of THEIR `emits` arrays,
			// so this same check naturally matches any of them.
			if (ability.emits?.includes(emission) !== true) continue;
			if (emission.requiresDamagingHit && !abilityDealsDamage(ability, gear)) continue;
			if (emission.gearCondition && !emission.gearCondition(ctx)) continue;

			const stillActive = active && placement.startTick < active.endTick;
			if (stillActive) {
				if (emission.reTriggerBehavior === 'burst') {
					if (emission.reTriggerEffect) {
						consumptions.push({
							placementId: placement.id,
							buffName: emission.buffName,
							effect: emission.reTriggerEffect,
							appliesToHits: 'all'
						});
					}
					active!.endTick = placement.startTick;
					activeByName.set(emission.buffName, null);
					continue; // 'burst' never starts a new instance on the same trigger
				}
				// 'restart' (default): fall through and start a fresh instance below, ending the old
				// one right at this tick, same as every existing self-buff re-cast in this app.
				active!.endTick = placement.startTick;
			}

			const counter = (instanceCounterByName.get(emission.buffName) ?? 0) + 1;
			instanceCounterByName.set(emission.buffName, counter);
			const fresh: ResolvedBuff = {
				placementId: `${emission.buffName}-${counter}`,
				abilityName: emission.buffName,
				startTick: placement.startTick,
				endTick: Math.min(placement.startTick + emission.durationTicks, timelineLength),
				extensions: []
			};
			buffs.push(fresh);
			activeByName.set(emission.buffName, fresh);
		}
	}

	return { buffs, consumptions };
}

export const GREATER_BARGE_BLEED_WINDOW_TICKS = 10; // 6s Endless Assault window
export const GREATER_BARGE_OUT_OF_COMBAT_TICKS = 8; // 4.8s since last damaging ability

/**
 * Resolves Greater Barge's "Endless Assault" conversion: casting Greater Barge grants a buff for
 * 10 ticks (6s) whose window is spent the moment the player's next melee CHANNELLED ability is
 * cast -- that placement is dealt as damage over time instead of a normal channel (i.e. it isn't
 * interrupted by whatever gets placed after it, per resolveChannels' `bleedPlacementIds`), rather
 * than losing its remaining hits the way an ordinary channel would.
 *
 * Per the wiki, Endless Assault is only granted at all if Greater Barge itself was cast while the
 * player had been out of combat with their target for at least 4.8s (8 ticks) -- modeled here as
 * "at least 8 ticks since the last damage-dealing ability" (per the user's direction: Berserk and
 * other non-damaging/defensive abilities don't reset this, only an actual damaging cast does,
 * e.g. Fury). The very first Greater Barge on an empty timeline always qualifies (nothing came
 * before it to be "in combat" with).
 */
export function resolveEndlessAssaultBleeds(
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	gear: GearContext
): { buffs: ResolvedBuff[]; bleedPlacementIds: Set<string> } {
	const buffs: ResolvedBuff[] = [];
	const bleedPlacementIds = new Set<string>();

	const sorted = [...placements].sort((a, b) => a.startTick - b.startTick);
	const damagingTicks = sorted
		.map((p) => {
			const ability = placementAbility(p, abilities);
			return ability && abilityDealsDamage(ability, gear) ? p.startTick : null;
		})
		.filter((t): t is number => t !== null);

	let active: ResolvedBuff | null = null;
	let instanceCounter = 0;
	for (const placement of sorted) {
		const ability = placementAbility(placement, abilities);
		if (!ability) continue;

		if (active && placement.startTick < active.endTick && parseHitProfile(ability).kind === 'channel') {
			bleedPlacementIds.add(placement.id);
			active.endTick = placement.startTick;
			active = null;
			continue;
		}

		if (ability.name === 'Greater Barge') {
			const priorDamagingTick = [...damagingTicks]
				.filter((t) => t < placement.startTick)
				.pop();
			const outOfCombat =
				priorDamagingTick === undefined ||
				placement.startTick - priorDamagingTick >= GREATER_BARGE_OUT_OF_COMBAT_TICKS;
			if (!outOfCombat) continue;

			instanceCounter++;
			active = {
				placementId: `endless-assault-${instanceCounter}`,
				abilityName: 'Endless Assault',
				startTick: placement.startTick,
				endTick: Math.min(
					placement.startTick + GREATER_BARGE_BLEED_WINDOW_TICKS,
					timelineLength
				),
				extensions: []
			};
			buffs.push(active);
		}
	}

	return { buffs, bleedPlacementIds };
}

export const CHAOS_ROAR_BUFF_NAME = 'Chaos Roar';
export const CHAOS_ROAR_DURATION_TICKS = 12; // 7.2s
export const CHAOS_ROAR_DAMAGE_MULTIPLIER = 1.75;

/**
 * Resolves Chaos Roar's "empowered next strike": casting it starts a buff lasting 12 ticks (7.2s),
 * consumed by the next damage-dealing melee ability the player uses, which then deals 1.75x base
 * damage -- same active-window/consumption shape as resolveGreaterFuryBuffs (one outstanding buff
 * at a time, re-casting simply restarts the window, only `abilityDealsDamage` placements consume
 * it).
 *
 * Unlike Greater Fury's crit multiplier (which scales a channel's whole pre-split total, so every
 * hit ends up boosted equally), Chaos Roar's bonus only applies to the FIRST hit of a channelled
 * ability that consumes it -- per the user's direction, matching how a single "next strike" bonus
 * naturally lands on just the opening hit of a multi-hit attack. A genuine bleed ability
 * (BLEED_ABILITY_NAMES) gets the bonus on all of its hits instead, since a bleed's hits are all
 * still that one "strike" landing over time rather than a channel's repeated separate attacks.
 * Critically, a channel that Greater Barge's Endless Assault turns into a non-interruptible bleed
 * (`endlessAssaultBleedPlacementIds`) is NOT a genuine bleed for this purpose -- it must still only
 * get the bonus on its first hit, since `damageByTick` discriminates via `profile.isBleed`
 * (BLEED_ABILITY_NAMES only), not the unioned isBleed value `resolveChannels` computes.
 *
 * Returns both the synthetic buff windows and the set of placement ids that actually consumed one,
 * exactly like resolveGreaterFuryBuffs.
 */
export function resolveChaosRoarBuffs(
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	gear: GearContext
): { buffs: ResolvedBuff[]; bonusPlacementIds: Set<string> } {
	const buffs: ResolvedBuff[] = [];
	const bonusPlacementIds = new Set<string>();

	const sorted = [...placements].sort((a, b) => a.startTick - b.startTick);

	let active: ResolvedBuff | null = null;
	let instanceCounter = 0;
	for (const placement of sorted) {
		const ability = placementAbility(placement, abilities);
		if (!ability) continue;

		if (active && placement.startTick < active.endTick) {
			if (abilityDealsDamage(ability, gear)) {
				bonusPlacementIds.add(placement.id);
				active.endTick = placement.startTick;
				active = null;
				continue;
			}
		}

		if (ability.name === CHAOS_ROAR_BUFF_NAME) {
			instanceCounter++;
			active = {
				placementId: `chaos-roar-${instanceCounter}`,
				abilityName: CHAOS_ROAR_BUFF_NAME,
				startTick: placement.startTick,
				endTick: Math.min(placement.startTick + CHAOS_ROAR_DURATION_TICKS, timelineLength),
				extensions: []
			};
			buffs.push(active);
		}
	}

	return { buffs, bonusPlacementIds };
}

/**
 * The single entry point every resolver in this file should use to get a placement's full set of
 * active buffs, INCLUDING Vestments of havoc's set-effect buffs (the synthetic "Havoc" window from
 * resolveHavocBuffs, and Berserk's 3-piece duration extension), Greater Fury's status buff,
 * Greater Barge's Endless Assault window, and Chaos Roar's empowered-next-strike buff -- rather
 * than each caller separately remembering to merge these in. `setPieceCounts` defaults to `{}` (no
 * sets equipped) and `gear` defaults to an always-two-handed/no-cape context (these status
 * effects don't key off gear variants the way damageVariants does, so this default only affects
 * whether a damageVariants-gated ability -- unrelated to any of them -- happens to be treated as
 * damaging) so existing call sites/tests that don't care about these effects are unaffected.
 */
export function resolveAllBuffs(
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	setPieceCounts: Record<string, number> = {},
	gear: GearContext = NO_GEAR_CONTEXT
): {
	buffs: ResolvedBuff[];
	havocInstantBursts: HavocInstantBurst[];
	greaterFuryCritPlacementIds: Set<string>;
	endlessAssaultBleedPlacementIds: Set<string>;
	chaosRoarBonusPlacementIds: Set<string>;
} {
	const baseBuffs = resolveBuffs(placements, abilities, timelineLength);
	const extended = applyVestmentsBerserkExtension(baseBuffs, setPieceCounts, timelineLength);
	const havoc = resolveHavocBuffs(placements, abilities, timelineLength, setPieceCounts);
	const fury = resolveGreaterFuryBuffs(placements, abilities, timelineLength, gear);
	const barge = resolveEndlessAssaultBleeds(placements, abilities, timelineLength, gear);
	const chaosRoar = resolveChaosRoarBuffs(placements, abilities, timelineLength, gear);
	return {
		buffs: [...extended, ...havoc.buffs, ...fury.buffs, ...barge.buffs, ...chaosRoar.buffs],
		havocInstantBursts: havoc.instantBursts,
		greaterFuryCritPlacementIds: fury.critPlacementIds,
		endlessAssaultBleedPlacementIds: barge.bleedPlacementIds,
		chaosRoarBonusPlacementIds: chaosRoar.bonusPlacementIds
	};
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

		if (ability.damagesOnTick) {
			// No `gear` available here (see parseHitProfile/parseBuffInfo above, same constraint) --
			// take the max offset across every gear variant as a safe upper bound instead of
			// resolving to one specific variant.
			const offsetLists = Array.isArray(ability.damagesOnTick)
				? [ability.damagesOnTick]
				: Object.values(ability.damagesOnTick);
			for (const offsets of offsetLists) {
				if (offsets.length > 0) {
					max = Math.max(max, p.startTick + Math.max(...offsets) + 1);
				}
			}
		}

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
 *  actually reaches further than that block alone. Null for a non-channelled ability, OR an
 *  unconditional bleed (BLEED_ABILITY_NAMES, e.g. Dismember/Slaughter/Massacre) -- there's nothing
 *  to "wait for" with a bleed since it's never interrupted regardless of what's placed after it
 *  (see resolveChannels), so click-to-place shouldn't hold off on its account either. Otherwise
 *  the same formula `requiredTimelineLength` uses for a channel's reach. */
function channelNaturalEndTick(ability: Ability, startTick: number): number | null {
	const profile = parseHitProfile(ability);
	if (profile.kind !== 'channel' || profile.isBleed) return null;
	return startTick + (profile.hits - 1) * profile.intervalTicks + 1;
}

/** First tick (0-indexed) where `ability` can legally be placed, for click-to-place. Skips past
 *  any existing channelled placement's FULL natural duration (not just its 3-tick GCD block) --
 *  click-to-place assumes the user wants any currently-running channel to finish uninterrupted,
 *  rather than landing partway through it and truncating it per resolveChannels' interruption
 *  behavior (dragging a placement to an exact tick can still deliberately interrupt a channel;
 *  this only affects the auto-picked slot for a plain palette click). Returns null if the timeline
 *  has no room left for it.
 *
 * `bleedPlacementIds` (Greater Barge's Endless Assault conversion) exempts those specific
 * placements from this "wait for it to finish" behavior the same way an unconditional bleed
 * (BLEED_ABILITY_NAMES, handled directly inside channelNaturalEndTick) already is -- a bleed is by
 * definition never interrupted by whatever comes after it (see resolveChannels), so there's
 * nothing for click-to-place to protect by holding off; the next ability can go right after the
 * bleed's own 3-tick GCD block, same as placing after any ordinary (non-channelled) ability. */
export function nextOpenTick(
	ability: Ability,
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	bleedPlacementIds: ReadonlySet<string> = new Set()
): number | null {
	const span = abilityTickSpan(ability);
	const channelEndTicks = placements
		.map((p) => {
			if (bleedPlacementIds.has(p.id)) return null;
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

/** Every ability's per-hit damage is capped at this value, regardless of how high AD/damage%
 *  pushes the computed total -- confirmed by the user as a real in-game cap that comes up often
 *  on high-damage-% Melee abilities like Overpower. Applied per LANDED HIT (i.e. after dividing a
 *  channel's total across its hits, and after any per-placement multiplier like Greater Fury's
 *  crit), not to an ability's pre-split total -- a channel's individual hits are each independently
 *  capped, not the channel's damage-total-before-division. */
export const MAX_DAMAGE_PER_HIT = 30000;

/**
 * Sums each placement's damage into the ticks it actually lands on. Single-hit abilities credit
 * their full `abilityDamageForPlacement` total (capped at MAX_DAMAGE_PER_HIT) to the start tick.
 * Channelled/DoT abilities divide that same total evenly across their hits (their stored
 * damagePercent is already the ability's full total, not a per-hit value -- see parseHitProfile),
 * cap EACH resulting per-hit share independently, and credit one (capped) share to each of
 * `resolveChannels`'s surviving hit ticks, so an interrupted channel's damage total drops
 * proportionally to match its visually-truncated hit window. Greater Barge's Endless
 * Assault-converted channels (`bleedPlacementIds`) are exempted from that truncation instead (see
 * resolveChannels), so their full natural damage always lands regardless of what's placed after.
 *
 * `critPlacementIds` (Greater Fury's consumption target, see resolveGreaterFuryBuffs) multiplies
 * that ONE specific placement's total damage by GREATER_FURY_CRIT_MULTIPLIER (1.5x) before it's
 * spread across hits (and before the per-hit cap is applied, so a crit can still be capped down) --
 * modeling a guaranteed critical strike as a flat damage multiplier, since this app has no
 * underlying crit-chance/crit-damage model to hook a "real" crit into.
 *
 * `chaosRoarPlacementIds` (Chaos Roar's consumption target, see resolveChaosRoarBuffs) multiplies
 * by CHAOS_ROAR_DAMAGE_MULTIPLIER (1.75x), but -- unlike Greater Fury's crit, which is folded into
 * `totalDamage` before the per-hit split so every hit of a channel is boosted equally -- Chaos
 * Roar's "empowers your next STRIKE" bonus only applies to a single hit: for a 'single'-kind
 * placement that's simply its one hit, but for a 'channel' it's ONLY the first surviving hit
 * (`resolved.hitTicks[0]`), unless the ability is a genuine bleed (`profile.isBleed`, i.e.
 * BLEED_ABILITY_NAMES), in which case every hit counts as part of that one bleed "strike" and all
 * get the bonus. Deliberately keyed off `profile.isBleed` rather than `resolved.isBleed` (which
 * also folds in Greater Barge's Endless Assault conversion) so a channel that only became
 * non-interruptible via Endless Assault still gets the bonus on its first hit alone, not all hits.
 *
 * `berserkBuffs` -- every ResolvedBuff whose `abilityName` is 'Berserk' (see resolveBuffs/
 * resolveAllBuffs) -- applies BERSERK_MELEE_DAMAGE_MULTIPLIER (1.75x) to a placement's total
 * damage whenever its start tick falls within any of those windows AND the ability is
 * `style === 'melee'` (per Berserk's own wording, "Melee attacks deal 1.75x damage" -- it does not
 * boost ranged/magic damage even though it's usable regardless of combat style). This stacks
 * multiplicatively with Greater Fury's crit and Chaos Roar's bonus, same as every other
 * multiplier here, since nothing in the wiki text suggests otherwise.
 *
 * `deathsSwiftnessBuffs` -- every ResolvedBuff whose `abilityName` is "Death's Swiftness" or
 * "Greater Death's Swiftness" -- applies DEATHS_SWIFTNESS_RANGED_DAMAGE_MULTIPLIER (1.5x) to a
 * placement's total damage under the same window/style-gating rule as Berserk above, just for
 * `style === 'ranged'` instead of melee.
 *
 * `searingWindsBuffs` -- every ResolvedBuff whose `abilityName` is 'Galeshot' (Searing Winds' own
 * casting ability, see BUFF_DISPLAY_NAME_TO_ABILITY_NAME) -- adds SEARING_WINDS_BONUS_PERCENT (20%)
 * of `adTotal`, flat, to EACH landed hit of a `style === 'ranged'` ability whose hit lands within
 * any of those windows (inclusive of the exact end tick, per the wiki: "An ability cast on the
 * same tick Searing Winds runs out will still fully benefit"). Unlike Berserk/Greater Fury/Chaos
 * Roar, which all scale a hit's OWN damage, this is a flat additive bonus independent of the hit's
 * own damage percent -- and unlike those, it's added AFTER the per-hit cap (each hit's own damage
 * is capped at MAX_DAMAGE_PER_HIT first, then Searing Winds' flat bonus is added on top, uncapped
 * by that same ceiling) since it's a wiki-documented always-applies rider, not part of the hit's
 * own scaling damage roll.
 *
 * Every 'single'-profile multi-hit ability (Deadshot's gear-dependent 4/8, Ricochet's 3, Adaptive
 * Strike's 2 -- see hitCountFor) now has its total damage split across `hitCountFor(ability, gear)`
 * simultaneous hits on its own start tick, each capped at MAX_DAMAGE_PER_HIT independently -- same
 * per-hit treatment a channel already got -- so Searing Winds' bonus can be credited once per ACTUAL
 * hit rather than once per placement (a Deadshot cast under Searing Winds gains 4x or 8x the flat
 * bonus, exactly matching the wiki's own worked recommendation list). Chaos Roar's "first hit only"
 * rule (see above) applies identically here: `i === 0` of this same-tick hit array.
 *
 * `hitChanceByStyle` -- the player's hit chance (0-100) against the selected target, keyed by
 * combat style, e.g. `{ melee: 87.4 }` (see formulas/hitChance.ts). Applied as a flat multiplier
 * (`hitChance / 100`) on `totalDamage`, same slot as every other multiplicative buff above --
 * this is not a modeling approximation, it's literally how RS3 damage works: there is no
 * separate hit/miss roll, a "miss" IS a 0 damage result already baked into the hit chance
 * formula's expected value, so scaling average damage by hit chance is the exact mechanic, not
 * a simplification of it. A style with no entry (or a missing/null selected target) defaults to
 * 100% via `?? 100`, so every existing call site that doesn't pass this stays byte-for-byte
 * identical to before hit chance was wired in.
 */
export function damageByTick(
	placements: TimelinePlacement[],
	abilities: Ability[],
	adTotal: number,
	gear: GearContext,
	timelineLength: number,
	critPlacementIds: ReadonlySet<string> = new Set(),
	bleedPlacementIds: ReadonlySet<string> = new Set(),
	chaosRoarPlacementIds: ReadonlySet<string> = new Set(),
	berserkBuffs: readonly ResolvedBuff[] = [],
	searingWindsBuffs: readonly ResolvedBuff[] = [],
	deathsSwiftnessBuffs: readonly ResolvedBuff[] = [],
	hitChanceByStyle: Partial<Record<CombatStyle, number>> = {},
	enemy: Enemy = DEFAULT_ENEMY,
	ctx: TickContext = DEFAULT_TICK_CONTEXT
): number[] {
	const result = new Array(timelineLength).fill(0);
	const channels = resolveChannels(placements, abilities, timelineLength, bleedPlacementIds);

	for (const placement of placements) {
		const ability = placementAbility(placement, abilities);
		if (!ability) continue;
		if (placement.startTick < 0 || placement.startTick >= timelineLength) continue;

		const profile = parseHitProfile(ability);
		let totalDamage = abilityDamageForPlacement(ability, adTotal, gear, enemy, ctx);
		if (critPlacementIds.has(placement.id)) {
			totalDamage = Math.floor(totalDamage * GREATER_FURY_CRIT_MULTIPLIER);
		}
		if (
			ability.style === 'melee' &&
			berserkBuffs.some(
				(b) => placement.startTick >= b.startTick && placement.startTick < b.endTick
			)
		) {
			totalDamage = Math.floor(totalDamage * BERSERK_MELEE_DAMAGE_MULTIPLIER);
		}
		if (
			ability.style === 'ranged' &&
			deathsSwiftnessBuffs.some(
				(b) => placement.startTick >= b.startTick && placement.startTick < b.endTick
			)
		) {
			totalDamage = Math.floor(totalDamage * DEATHS_SWIFTNESS_RANGED_DAMAGE_MULTIPLIER);
		}
		const hitChance =
			(hitChanceByStyle as Partial<Record<string, number>>)[ability.style] ?? 100;
		if (hitChance !== 100) {
			totalDamage = Math.floor(totalDamage * (hitChance / 100));
		}
		const hasChaosRoarBonus = chaosRoarPlacementIds.has(placement.id);
		const searingWindsBonusPerHit =
			ability.style === 'ranged'
				? Math.floor(adTotal * SEARING_WINDS_BONUS_PERCENT)
				: 0;

		if (profile.kind === 'channel') {
			const resolved = channels.find((c) => c.placementId === placement.id);
			const perHitDamage = Math.min(Math.floor(totalDamage / profile.hits), MAX_DAMAGE_PER_HIT);
			const boostedPerHitDamage = Math.min(
				Math.floor(perHitDamage * CHAOS_ROAR_DAMAGE_MULTIPLIER),
				MAX_DAMAGE_PER_HIT
			);
			const hitTicks = resolved?.hitTicks ?? [];
			hitTicks.forEach((tick, i) => {
				const boosted = hasChaosRoarBonus && (profile.isBleed || i === 0);
				const searingWindsBonus =
					searingWindsBonusPerHit > 0 &&
					searingWindsBuffs.some((b) => tick >= b.startTick && tick <= b.endTick)
						? searingWindsBonusPerHit
						: 0;
				result[tick] += (boosted ? boostedPerHitDamage : perHitDamage) + searingWindsBonus;
			});
		} else {
			// resolveHitOffsets supersedes hitCountFor + resolveDamagesOnTick for a migrated ability
			// (its result IS both the hit count, via .length, and the per-hit tick offsets from the
			// placement's own startTick, e.g. Ricochet's [0, 1, 1]) -- falls back to the exact same
			// legacy behavior as before for any not-yet-migrated ability.
			const offsets = resolveHitOffsets(ability, gear, enemy, ctx);
			const hitCount = offsets.length;
			const perHitDamage = Math.min(Math.floor(totalDamage / hitCount), MAX_DAMAGE_PER_HIT);
			const boostedPerHitDamage = Math.min(
				Math.floor(perHitDamage * CHAOS_ROAR_DAMAGE_MULTIPLIER),
				MAX_DAMAGE_PER_HIT
			);
			offsets.forEach((offset, i) => {
				const tick = placement.startTick + offset;
				if (tick < 0 || tick >= timelineLength) return;
				const searingWindsBonus =
					searingWindsBonusPerHit > 0 &&
					searingWindsBuffs.some((b) => tick >= b.startTick && tick <= b.endTick)
						? searingWindsBonusPerHit
						: 0;
				const boosted = hasChaosRoarBonus && i === 0;
				result[tick] += (boosted ? boostedPerHitDamage : perHitDamage) + searingWindsBonus;
			});
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

/** Default trailing window for the sliding-window DPM line -- a full minute, so the line reads
 *  directly as "damage per minute" rather than a shorter window rescaled up to look like one. */
export const DPM_WINDOW_SECONDS = 60;

/**
 * Trailing-window damage-per-minute at each tick: sum of damage dealt within the last
 * `windowSeconds` (including the current tick), divided by however much of that window has
 * actually elapsed so far (`min(windowSeconds, elapsedSeconds)`) -- NOT always the full window.
 * Unlike `runningAverageDps` -- whose denominator grows for the whole fight, permanently smoothing
 * out any burst/lull as the timeline goes on -- a sliding window stays sensitive to what's actually
 * happening "now", which is what makes it useful as a chart line to inspect a rotation's shape
 * rather than just its final average.
 *
 * Earlier versions of this function divided by the FULL window unconditionally, even at tick 3 of
 * a 100-tick window where 97 of those ticks are simply in the future and haven't happened yet --
 * that's a fundamentally different kind of zero than a real lull later in the fight, but the full
 * fixed denominator treated them identically, permanently understating the true early-fight rate
 * (e.g. one ability's hit at tick 1 would read as ~1/33rd its real annualized rate at a 3-tick-per-
 * window-so-far point). Clamping the divisor to elapsed time fixes exactly that without giving up
 * the sliding window's responsiveness once the window is actually full: after `windowSeconds` of
 * elapsed time, `min` always resolves to the constant `windowFullSeconds` and behavior is identical
 * to before.
 *
 * The divisor is additionally floored at `MIN_DPM_WINDOW_SECONDS` (3 ticks / 1.8s -- the global
 * cooldown), not allowed to shrink all the way to a single tick. Below one GCD's worth of elapsed
 * time, no second ability could possibly have landed yet regardless of how fast the player plays,
 * so letting the divisor keep shrinking tick-by-tick (0.6s, then 1.2s, then 1.8s) would produce a
 * spike-then-decay artifact -- an artificially huge DPM at the exact tick of the first hit that
 * "decays" back down to the steady value over the next couple ticks, even though nothing about the
 * rotation actually changed in that window. Flooring at one GCD instead makes the first hit read as
 * one flat, correct rate from tick 0 through the earliest tick another hit could legally land.
 */
export const MIN_DPM_WINDOW_SECONDS = GCD_TICKS * TICK_SECONDS;

export function slidingWindowDpm(
	byTick: number[],
	windowSeconds = DPM_WINDOW_SECONDS,
	tickSeconds = TICK_SECONDS
): number[] {
	const windowTicks = Math.max(1, Math.round(windowSeconds / tickSeconds));
	const windowFullSeconds = windowTicks * tickSeconds;
	const result: number[] = new Array(byTick.length);
	let windowSum = 0;
	for (let i = 0; i < byTick.length; i++) {
		windowSum += byTick[i];
		const dropIndex = i - windowTicks;
		if (dropIndex >= 0) windowSum -= byTick[dropIndex];
		const elapsedSeconds = (i + 1) * tickSeconds;
		const divisorSeconds = Math.min(
			windowFullSeconds,
			Math.max(MIN_DPM_WINDOW_SECONDS, elapsedSeconds)
		);
		result[i] = (windowSum / divisorSeconds) * 60;
	}
	return result;
}

/**
 * End-to-end damage-over-time series for one setup's rotation: resolves buffs, then
 * per-tick/cumulative/DPM damage -- exactly what Timeline.svelte derives internally for its own
 * chart, extracted so the same pipeline can be run for every setup at once (e.g. `+page.svelte`'s
 * multi-setup overlay chart) without duplicating the buff-resolution wiring per call site.
 */
export function computeDamageSeries(
	placements: TimelinePlacement[],
	abilities: Ability[],
	adTotal: number,
	gear: GearContext,
	timelineLength: number,
	setPieceCounts: Record<string, number> = {},
	hitChanceByStyle: Partial<Record<CombatStyle, number>> = {}
): { tickDamage: number[]; cumulative: number[]; dpm: number[] } {
	const allBuffs = resolveAllBuffs(placements, abilities, timelineLength, setPieceCounts, gear);
	const berserkBuffs = allBuffs.buffs.filter((b) => b.abilityName === 'Berserk');
	const searingWindsBuffs = allBuffs.buffs.filter((b) => b.abilityName === 'Galeshot');
	const deathsSwiftnessBuffs = allBuffs.buffs.filter(
		(b) => b.abilityName === "Death's Swiftness" || b.abilityName === "Greater Death's Swiftness"
	);
	const tickDamage = damageByTick(
		placements,
		abilities,
		adTotal,
		gear,
		timelineLength,
		allBuffs.greaterFuryCritPlacementIds,
		allBuffs.endlessAssaultBleedPlacementIds,
		allBuffs.chaosRoarBonusPlacementIds,
		berserkBuffs,
		searingWindsBuffs,
		deathsSwiftnessBuffs,
		hitChanceByStyle
	);
	return {
		tickDamage,
		cumulative: cumulativeDamage(tickDamage),
		dpm: slidingWindowDpm(tickDamage)
	};
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
 * layered resolution: `hitCountVariants` for the player's current gear (e.g. Deadshot's 4-vs-8
 * hits with Igneous Kal-Xil/Kal-Zuk) takes priority over everything else, since it's the one
 * explicit, curated source of truth when it exists; else a channelled ability's own hit count;
 * else a bare "N hits." phrase in the description (covers simultaneous multi-hit abilities like
 * Adaptive Strike's "2 hits."); else a hand-curated override; else a plain single hit.
 *
 * `hitCountVariants` must win over the bare-hits regex specifically because an ability with a
 * gear-dependent hit count now mentions BOTH counts in its own description text (e.g. Deadshot:
 * "...4 hits (Igneous Kal-Xil or Igneous Kal-Zuk: ...8 hits)"), so the regex alone would always
 * match whichever number appears first, regardless of what's actually equipped.
 */
export function hitCountFor(ability: Ability, gear: GearContext = NO_GEAR_CONTEXT): number {
	const variantCount = resolveHitCountVariant(ability, gear);
	if (variantCount !== null) return variantCount;

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
 *  else just its own start tick, scaled to hitCountFor(ability, gear) copies for a simultaneous
 *  multi-hit ability (Ricochet's 3, Adaptive Strike's 2, Deadshot's gear-dependent 4/8) since those
 *  don't have distinct timing to spread across. */
export function hitTicksForPlacement(
	placement: TimelinePlacement,
	ability: Ability,
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	gear: GearContext = NO_GEAR_CONTEXT
): number[] {
	const profile = parseHitProfile(ability);
	if (profile.kind === 'channel') {
		const channels = resolveChannels(placements, abilities, timelineLength);
		const channel = channels.find((c) => c.placementId === placement.id);
		return channel?.hitTicks ?? [];
	}
	return Array(hitCountFor(ability, gear)).fill(placement.startTick);
}

export interface AdrenalineState {
	value: number;
	/** True at a spend-placement's tick if the banked adrenaline just before it was less than the
	 *  amount required -- purely informational (see resolveAdrenaline's doc comment), never blocks
	 *  placement. */
	insufficientForCost: boolean;
	/** The resource engine's own resolved ceiling for this tick -- normally 100, raised to 120 by
	 *  Vestments of havoc's 4-piece bonus while active (see resolveResource's generic `cap`
	 *  aspect). Exposed the same way resolveBloodlust already exposes Berserk's cap raise. */
	cap: number;
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
 * GlobalContext.ringOfVigourActive), regardless of anything happening on the timeline.
 */
export const RING_OF_VIGOUR_MODIFIER: PassiveModifier = {
	kind: 'passive',
	subject: 'player',
	resourceId: 'adrenaline',
	resourceAspect: 'costRefund',
	effect: { operation: 'add', value: RING_OF_VIGOUR_REFUND_PERCENT },
	source: { label: 'Ring of Vigour' },
	appliesToAbility: (ability) => ability.type === 'Ultimate' && ability.adrenaline < 0,
	isActive: (ctx) => ctx.global.ringOfVigourActive
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
	requiresContext: (ctx) => ctx.global.combatStyle === 'ranged',
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
	isActive: (ctx) => ctx.global.furyOfTheSmallActive
};

/** Vestments of havoc's 2-piece "Herald of Chaos" regen: 15% adrenaline spread evenly over
 *  Havoc's 30-tick (18s) window -- 0.5%/tick. Modeled as a buffWindow perTickIncome against the
 *  synthetic "Havoc" buff produced by resolveHavocBuffs (merged into resolveAdrenaline's own buffs
 *  array), the same mechanism Meteor Strike's ambient income already uses. The instant 20% burst
 *  from re-triggering while active is a separate one-off event (HavocInstantBurst) resolved via
 *  ResourceDefinition.costRefundForPlacement instead of this generic per-tick path, since it's
 *  tied to one specific placement rather than a recurring tick cadence any Modifier gate can
 *  express (see resolveAdrenaline). */
export const HAVOC_REGEN_PER_TICK = HAVOC_REGEN_PERCENT / HAVOC_DURATION_TICKS;

export const HAVOC_REGEN_MODIFIER: BuffWindowModifier = {
	kind: 'buffWindow',
	subject: 'player',
	resourceId: 'adrenaline',
	resourceAspect: 'perTickIncome',
	buffAbilityName: HAVOC_BUFF_NAME,
	effect: { operation: 'add', value: HAVOC_REGEN_PER_TICK },
	intervalTicks: 1,
	source: { label: 'Herald of Chaos (Vestments of havoc, 2pc)' }
};

/** Vestments of havoc's 4-piece bonus: +20% maximum adrenaline while wielding a melee weapon.
 *  A plain cap override, resolved by the same generic `cap` aspect Berserk's Bloodlust-cap raise
 *  already uses -- gated on the generalized `setPieceCounts` context rather than a per-set boolean,
 *  so future set effects that raise a resource's cap need only a new Modifier entry, not new
 *  TickContext fields or resolver code. */
export const VESTMENTS_OF_HAVOC_4PC_ADRENALINE_CAP = 120;

export const VESTMENTS_OF_HAVOC_4PC_CAP_MODIFIER: PassiveModifier = {
	kind: 'passive',
	subject: 'player',
	resourceId: 'adrenaline',
	resourceAspect: 'cap',
	effect: { operation: 'override', value: VESTMENTS_OF_HAVOC_4PC_ADRENALINE_CAP },
	source: { label: 'Herald of Chaos (Vestments of havoc, 4pc)' },
	isActive: (ctx) =>
		(ctx.setPieceCounts[VESTMENTS_OF_HAVOC_SET_NAME] ?? 0) >= 4 && ctx.hasMeleeWeaponEquipped
};

/** Adrenaline renewal potion: not a real ability, just modeled as one so it can be placed on the
 *  timeline like an off-GCD utility -- its own `adrenaline` field is 0 (see data/abilities.ts),
 *  with all of its gain coming from this buffWindow perTickIncome modifier across its own
 *  10-tick duration (parsed off its description by parseBuffInfo/resolveBuffs, same mechanism as
 *  Meteor Strike/Havoc above). */
export const ADRENALINE_RENEWAL_PER_TICK = 4;

export const ADRENALINE_RENEWAL_MODIFIER: BuffWindowModifier = {
	kind: 'buffWindow',
	subject: 'player',
	resourceId: 'adrenaline',
	resourceAspect: 'perTickIncome',
	buffAbilityName: 'Adrenaline renewal potion',
	effect: { operation: 'add', value: ADRENALINE_RENEWAL_PER_TICK },
	intervalTicks: 1,
	source: { label: 'Adrenaline renewal potion' }
};

const ADRENALINE_MODIFIERS: Modifier[] = [
	RING_OF_VIGOUR_MODIFIER,
	IMBUE_SHADOWS_ADRENALINE_MODIFIER,
	METEOR_STRIKE_ADRENALINE_MODIFIER,
	METEOR_STRIKE_BASIC_MULTIPLIER_MODIFIER,
	FURY_OF_THE_SMALL_MODIFIER,
	HAVOC_REGEN_MODIFIER,
	ADRENALINE_RENEWAL_MODIFIER,
	VESTMENTS_OF_HAVOC_4PC_CAP_MODIFIER
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
 * Meteor Strike's passive income/generation boost, Fury of the Small's flat +1 generation, and
 * Vestments of havoc's set effects (2pc regen/instant burst, 4pc cap raise) as Modifier objects
 * rather than ad hoc checks. 120%+ is supported only via an active cap-raising Modifier (e.g.
 * Vestments' 4-piece bonus) -- with no such Modifier active the cap still defaults to 100. A spend
 * attempted without enough banked adrenaline still applies and clamps at 0 -- flagged via
 * `insufficientForCost`, never blocked.
 */
export function resolveAdrenaline(
	placements: TimelinePlacement[],
	abilities: Ability[],
	combatStyle: CombatStyle | null,
	startingAdrenaline: number,
	timelineLength: number,
	ringOfVigourActive = false,
	furyOfTheSmallActive = false,
	setPieceCounts: Record<string, number> = {},
	hasMeleeWeaponEquipped = false,
	gear: GearContext = NO_GEAR_CONTEXT
): AdrenalineState[] {
	const { buffs, havocInstantBursts } = resolveAllBuffs(
		placements,
		abilities,
		timelineLength,
		setPieceCounts,
		gear
	);
	const ctx: TickContext = {
		global: { combatStyle, ringOfVigourActive, furyOfTheSmallActive },
		gear,
		setPieceCounts,
		hasMeleeWeaponEquipped
	};
	// Vestments of havoc's instant 20% burst (re-triggering Havoc while already active) fires only
	// on the SPECIFIC melee-ultimate placement that caused the re-trigger -- not every melee
	// ultimate cast, and not derivable from the ability alone, so it can't be expressed as an
	// ordinary Modifier (PassiveModifier.isActive/appliesToAbility never see the tick or the
	// specific placement instance). costRefundForPlacement exists exactly for this: it fires
	// alongside the placement's own costRefund Modifiers, keyed on the exact placement rather than
	// a static gate.
	const burstTicksByPlacementId = new Map(havocInstantBursts.map((b) => [b.placementId, b.percent]));
	const definition: ResourceDefinition = {
		...ADRENALINE_DEFINITION,
		startingValue: startingAdrenaline,
		hitTicksForPlacement: (placement, ability) =>
			hitTicksForPlacement(placement, ability, placements, abilities, timelineLength, gear),
		costRefundForPlacement: (placement) => burstTicksByPlacementId.get(placement.id) ?? 0
	};

	const states = resolveResource(
		definition,
		placements,
		abilities,
		ADRENALINE_MODIFIERS,
		buffs,
		ctx,
		timelineLength
	);

	return states.map(({ value, insufficientForCost, cap }) => ({ value, insufficientForCost, cap }));
}

export const BLOODLUST_BASE_CAP = 4;
export const BLOODLUST_BERSERK_CAP = 8;
export const BERSERK_BASIC_MULTIPLIER = 2;
/** "Melee attacks deal 1.75x damage" while Berserk is active -- see damageByTick's `berserkBuffs`
 *  param, gated on `ability.style === 'melee'` since Berserk doesn't boost ranged/magic damage. */
export const BERSERK_MELEE_DAMAGE_MULTIPLIER = 1.75;

/** "Ranged attacks deal 1.5x damage" while Death's Swiftness/Greater Death's Swiftness is active --
 *  see damageByTick's `deathsSwiftnessBuffs` param, gated on `ability.style === 'ranged'`, the exact
 *  ranged analogue of Berserk's melee multiplier above. Both abilities share this multiplier and are
 *  matched by `abilityName` (see BUFF_DISPLAY_NAME_TO_ABILITY_NAME-less direct lookup below), since
 *  neither renames its buff the way Galeshot/Imbue: Shadows do. */
export const DEATHS_SWIFTNESS_RANGED_DAMAGE_MULTIPLIER = 1.5;

/** "Ranged attacks deal an additional 20% ability damage bonus damage with each hit" while
 *  Galeshot's Searing Winds is active -- see damageByTick's `searingWindsBuffs` param, gated on
 *  `ability.style === 'ranged'`. A FLAT addition of `adTotal * 0.20` per landed hit, not a
 *  multiplier on the hit's own damage (unlike Berserk/Greater Fury/Chaos Roar) -- confirmed by the
 *  wiki's exact wording ("bonus damage", not "increased damage" or "Nx damage"). */
export const SEARING_WINDS_BONUS_PERCENT = 0.2;

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
 * skipped, same permissive spirit as everywhere else in this file. `setPieceCounts` defaults to
 * `{}` -- Vestments of havoc's 3-piece bonus extends Berserk's own duration (see
 * applyVestmentsBerserkExtension via resolveAllBuffs), which in turn widens the window this
 * resource's Berserk-gated Modifiers stay active for.
 */
export function resolveBloodlust(
	placements: TimelinePlacement[],
	abilities: Ability[],
	timelineLength: number,
	setPieceCounts: Record<string, number> = {}
): ResourceState[] {
	const { buffs } = resolveAllBuffs(placements, abilities, timelineLength, setPieceCounts);
	const ctx: TickContext = {
		...DEFAULT_TICK_CONTEXT,
		setPieceCounts
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
