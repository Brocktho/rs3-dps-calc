/**
 * Accuracy formulas, per https://runescape.wiki/w/Combat_Stats
 */

import type { CombatStyle } from './abilityDamage';

/**
 * Skill Bonus for Accuracy: L^3/1250 + 4L + 40, where L is the player's level in the
 * skill matching the wielded weapon's combat style (Attack/Ranged/Magic). Necromancy
 * uses the same curve via its own skill level.
 */
export function accuracySkillBonus(level: number): number {
	return Math.pow(level, 3) / 1250 + 4 * level + 40;
}

/**
 * For each wielded weapon style, the armour style that is "weak against" it -- i.e. the
 * class this weapon style beats -- gets the 1.5x Hybrid Nerf coefficient (per the wiki's
 * own worked example: wielding a magic weapon, melee armour is the 1.5x class). Necromancy
 * sits outside the triangle and is never anyone's 1.5x weakness.
 * Melee beats Ranged, Ranged beats Magic, Magic beats Melee.
 */
const weakAgainst: Record<CombatStyle, CombatStyle | null> = {
	melee: 'ranged',
	ranged: 'magic',
	magic: 'melee',
	necromancy: null
};

/**
 * Hybrid Nerf: -(1.5*A + 0.8*B), where A is the armour value of the class weak against
 * the wielded weapon's class, and B is the armour value of all other off-class armour
 * (excluding the weapon's own class and the class already counted in A). Each piece's
 * raw armour value is floored individually after applying its coefficient, then summed
 * -- confirmed against exact in-game readings (Malevolent cuirass alone: -400; cuirass +
 * greaves: -783, which only matches floor(0.8*500.9) + floor(0.8*479.1), not
 * floor(0.8*(500.9+479.1))). Pieces with a `null` armourClass (hybrid jewelry, the igneous
 * Kal-Zuk cape) sit outside the combat triangle entirely and never contribute a penalty,
 * regardless of wielded weapon.
 */
export function hybridNerf(
	weaponStyle: CombatStyle,
	armourPieces: { armourClass: CombatStyle | null; armour: number }[]
): number {
	const weakStyle = weakAgainst[weaponStyle];
	let penalty = 0;
	for (const piece of armourPieces) {
		if (piece.armourClass === null || piece.armourClass === weaponStyle) continue;
		const coefficient = piece.armourClass === weakStyle ? 1.5 : 0.8;
		penalty += Math.floor(coefficient * piece.armour);
	}
	return penalty === 0 ? 0 : -penalty;
}
