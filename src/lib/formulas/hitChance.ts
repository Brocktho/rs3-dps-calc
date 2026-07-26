import { baseArmourRating } from './armourRating';

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
