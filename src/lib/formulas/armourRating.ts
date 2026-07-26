/**
 * Armour rating formulas, per https://runescape.wiki/w/Hit_chance#Armour_rating
 */

/**
 * The armour bonus granted by Defence level alone (i.e. with no armour equipped).
 * f(x) = x^3/1250 + 4x + 40, rounded down.
 *
 * A player's full armour rating is this value plus the sum of their worn armour's
 * armour bonuses, rounded down -- worn armour isn't modeled yet, so this function
 * currently represents the player's Total Armour with nothing equipped.
 */
export function baseArmourRating(defenceLevel: number): number {
	return Math.floor(Math.pow(defenceLevel, 3) / 1250 + 4 * defenceLevel + 40);
}
