import { baseArmourRating } from './armourRating';
import type { GearContext, GlobalContext } from './context';
import type { ModifierSource } from './modifiers';

/**
 * Hit chance formulas, per https://runescape.wiki/w/Hit_chance
 */

/**
 * A target's total armour rating: their own armour stat plus the armour bonus granted by
 * their Defence level, per https://runescape.wiki/w/Hit_chance#Armour_rating. Bosses' armour
 * (scraped into Boss.armour) already represents their gear/natural armour value separately
 * from the Defence-level bonus, mirroring how a player's armour and Defence level are summed.
 */
export function targetArmourRating(targetArmour: number, targetDefenceLevel: number): number {
	return targetArmour + baseArmourRating(targetDefenceLevel);
}

/**
 * Necromancy always uses the "middle" default affinity value (60) against any target,
 * regardless of that target's own custom affinity values -- per the wiki: "Necromancy always
 * uses the middle affinity value for monsters with custom values." This is a fixed constant,
 * not something derived from a per-monster scraped field (no aff_necromancy field exists on
 * the wiki's Infobox Monster template at all).
 */
export const NECROMANCY_AFFINITY = 60;

/**
 * Hit chance H = Affinity * (a/d), capped at 100%, per
 * https://runescape.wiki/w/Hit_chance#The_hit_chance_formula. `a` is the player's total
 * accuracy (weapon + skill bonus + hybrid nerf, see formulas/accuracy.ts), `d` is the
 * target's armour rating (see targetArmourRating above), and `affinity` is the target's
 * affinity against the player's combat style (general per-style affinity, e.g. aff_melee --
 * NOT aff_weakness, which the wiki says only applies when attacking with the target's exact
 * named sub-type weakness like "Bolts" or "Fire", not just the matching general style).
 */
export function hitChance(affinity: number, accuracy: number, armourRating: number): number {
	if (armourRating <= 0) return 100;
	return Math.min(100, (affinity * accuracy) / armourRating);
}

/**
 * Armour/jewelry special effects that shift hit chance BEFORE the cap (design §3) -- declared as
 * data on a registry entry, never hardcoded in the formula. Negative `amountPercent` for
 * penalties.
 */
export interface HitChanceAdjustment {
	source: ModifierSource;
	/** Additive percentage points applied pre-cap; negative for penalties. */
	amountPercent: number;
	isActive: (gear: GearContext, global: GlobalContext) => boolean;
}

/** An adjustment that actually applied, for provenance display. */
export interface AppliedHitChanceAdjustment {
	source: ModifierSource;
	amountPercent: number;
}

/**
 * The full hit-chance computation, split into named steps that must run in exactly this order
 * (docs/resolution-pipeline-design.md §3). The load-bearing edge case is over-cap ordering: `raw`
 * is preserved UNCAPPED so a 115% raw minus a 10% penalty correctly lands at 100% final, not 90%.
 * The cap is applied exactly once, last -- no adjustment ever reads or writes the capped value.
 */
export interface HitChanceBreakdown {
	/** Affinity * (accuracy / armourRating) -- UNCAPPED. May exceed 100 (e.g. 115). */
	raw: number;
	/** Every pre-cap adjustment that applied, for provenance display. */
	adjustments: AppliedHitChanceAdjustment[];
	/** raw + sum of adjustments, still uncapped (115 - 10 = 105). */
	adjusted: number;
	/** clamp(adjusted, 0, 100). The only value damage math may consume. */
	final: number;
}

/**
 * Every known hit-chance-shifting item effect. Empty until the first such item's data is added --
 * the pipeline is proven by tests with synthetic adjustments first, the same way the BuffEmission
 * engine was proven before real data used it.
 */
export const HIT_CHANCE_ADJUSTMENTS: HitChanceAdjustment[] = [];

/**
 * Recomputed per gear segment once the gear buffer lands (design §5): a swap that changes
 * accuracy or removes a penalty item yields a new breakdown for the following segment. Today
 * there is one segment (the whole timeline), so callers compute it once per gear/enemy change.
 */
export function hitChanceBreakdown(
	affinity: number,
	accuracy: number,
	armourRating: number,
	gear: GearContext,
	global: GlobalContext,
	adjustments: HitChanceAdjustment[] = HIT_CHANCE_ADJUSTMENTS
): HitChanceBreakdown {
	// armourRating <= 0 has no meaningful ratio -- treat raw as a guaranteed 100, matching
	// hitChance()'s existing degenerate-case behavior. Adjustments still apply pre-cap.
	const raw = armourRating <= 0 ? 100 : (affinity * accuracy) / armourRating;
	const applied = adjustments
		.filter((a) => a.isActive(gear, global))
		.map(({ source, amountPercent }) => ({ source, amountPercent }));
	const adjusted = raw + applied.reduce((sum, a) => sum + a.amountPercent, 0);
	const final = Math.min(100, Math.max(0, adjusted));
	return { raw, adjustments: applied, adjusted, final };
}
