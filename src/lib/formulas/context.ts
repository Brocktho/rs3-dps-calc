/**
 * The context layers every predicate/modifier gate and ability resolver sees, per
 * docs/resolution-pipeline-design.md §4 ("Stage 3 — GlobalContext"):
 *
 *   - GearContext: derived from the equipped loadout. Today it is built once by the UI; under the
 *     gear buffer (design §5) it becomes per-segment, so nothing outside a TickContext may assume
 *     it is constant across the timeline.
 *   - GlobalContext: everything configured outside the timeline that CANNOT change during combat
 *     (account unlocks, combat style). Frozen for the whole timeline.
 *   - TickContext: the composition assembled per tick -- the replacement for the old monolithic
 *     ModifierContext, which mixed frozen globals with gear-derived state.
 */
import type { CombatStyle } from './abilityDamage';

export interface GearContext {
	isTwoHanded: boolean;
	hasOffHandWeapon: boolean;
	equippedCapeName: string | null;
}

/** Gear context to assume when the caller doesn't have (or care about) one -- e.g. call sites
 *  that pre-date gear-dependent resolution and don't pass gear at all. Always two-handed, no
 *  cape, so a gear-dependent value falls back to each ability's "Any" behavior rather than
 *  silently guessing a cape is worn. */
export const NO_GEAR_CONTEXT: GearContext = {
	isTwoHanded: true,
	hasOffHandWeapon: false,
	equippedCapeName: null
};

/** Everything configured outside the timeline that cannot change during combat: account unlocks,
 *  prayer/toggle config, combat style. FROZEN for the whole timeline (design §4). */
export interface GlobalContext {
	combatStyle: CombatStyle | null;
	ringOfVigourActive: boolean;
	furyOfTheSmallActive: boolean;
}

/** Neutral globals for callers with no configured state -- no unlocks, no style selected. */
export const DEFAULT_GLOBAL_CONTEXT: GlobalContext = {
	combatStyle: null,
	ringOfVigourActive: false,
	furyOfTheSmallActive: false
};

/**
 * What every predicate/modifier gate sees at a given tick. Assembled, never stored -- nothing may
 * cache a TickContext across ticks; it is only valid for the tick it was assembled for. Until the
 * gear buffer lands (design §5) the same object is valid for every tick of a resolution pass,
 * because gear cannot yet change mid-timeline -- but consumers must not rely on that.
 */
export interface TickContext {
	/** Identical object every tick -- frozen at stage 3. */
	global: GlobalContext;
	/** From the gear buffer segment covering this tick (today: the whole-timeline gear). */
	gear: GearContext;
	/** How many pieces of each armour set (keyed by Armour.setName, e.g. "Vestments of havoc
	 *  armour") are equipped at this tick -- generalizes across every set-effect armour, so a new
	 *  set only needs new Modifier entries gated on this count, never a new context field.
	 *  Absent/0 for sets with nothing equipped. */
	setPieceCounts: Record<string, number>;
	/** Whether the main-hand is a melee weapon at this tick -- Vestments of havoc's 4-piece bonus
	 *  (+20% max adrenaline) is conditioned on this, not just the armour itself. */
	hasMeleeWeaponEquipped: boolean;
}

/** Neutral tick context for callers that don't care about context-dependent resolution -- no sets
 *  worn, no unlocks active, matching every other "no assumption entered" default. */
export const DEFAULT_TICK_CONTEXT: TickContext = {
	global: DEFAULT_GLOBAL_CONTEXT,
	gear: NO_GEAR_CONTEXT,
	setPieceCounts: {},
	hasMeleeWeaponEquipped: false
};
