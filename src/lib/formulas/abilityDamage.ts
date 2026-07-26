/**
 * Ability damage formulas, per https://runescape.wiki/w/Ability_damage
 */

export type CombatStyle = 'magic' | 'melee' | 'ranged' | 'necromancy';

export type WeaponConfig =
	| { kind: 'dualWield'; mainHandTier: number; offHandTier: number }
	| { kind: 'twoHanded'; tier: number };

export interface AbilityDamageInput {
	style: CombatStyle;
	weapon: WeaponConfig;
	/** Player's level in the style's skill (Magic/Strength/Ranged/Necromancy), including boosts. */
	level: number;
	/** Sum of the player's style-relevant bonuses from armour and jewellery. */
	bonus: number;
	/**
	 * Spell tier (Magic) or ammunition tier (Ranged). Ignored for Melee and Necromancy.
	 * For ammo-less ranged weapons (thrown weapons, chargebows with no ammo equipped),
	 * pass the weapon's own tier.
	 */
	styleTier?: number;
}

export interface AbilityDamageResult {
	mainHand: number;
	offHand: number;
	total: number;
}

/**
 * Level bonus curve shared by all combat styles.
 * f(level) = 145 * ln(1 + 0.6 * level / 145) / ln(1.6)
 */
export function levelBonus(level: number): number {
	return (145 * Math.log(1 + (0.6 * level) / 145)) / Math.log(1.6);
}

function oneHandedAd(f: number, tier: number, styleCap: number | undefined, bonus: number): number {
	const effectiveTier = styleCap === undefined ? tier : Math.min(tier, styleCap);
	return Math.floor(2.5 * f) + Math.floor(9.6 * effectiveTier + bonus);
}

function offHandAd(mainHandEquivalentAd: number): number {
	return Math.floor(0.5 * mainHandEquivalentAd);
}

function twoHandedAd(f: number, tier: number, styleCap: number | undefined, bonus: number): number {
	const effectiveTier = styleCap === undefined ? tier : Math.min(tier, styleCap);
	return (
		Math.floor(2.5 * f) + Math.floor(1.25 * f) + Math.floor(14.4 * effectiveTier + 1.5 * bonus)
	);
}

/**
 * Computes ability damage (AD) for Magic, Melee, or Ranged, which all share the same
 * formula structure and differ only in which skill level and style-tier (spell/ammo) is used.
 */
function styleAd(
	level: number,
	weapon: WeaponConfig,
	bonus: number,
	styleTier: number | undefined
): AbilityDamageResult {
	const f = levelBonus(level);

	if (weapon.kind === 'twoHanded') {
		const total = twoHandedAd(f, weapon.tier, styleTier, bonus);
		return { mainHand: total, offHand: 0, total };
	}

	const mainHand = oneHandedAd(f, weapon.mainHandTier, styleTier, bonus);
	const offHand = offHandAd(oneHandedAd(f, weapon.offHandTier, styleTier, bonus));
	return { mainHand, offHand, total: mainHand + offHand };
}

/**
 * Necromancy uses the same shape as the other styles but has no spell/ammo tier comparison
 * (weapon tier is used directly) and has no two-handed weapon case.
 */
function necromancyAd(level: number, weapon: WeaponConfig, bonus: number): AbilityDamageResult {
	if (weapon.kind === 'twoHanded') {
		throw new Error('Necromancy has no two-handed weapon ability damage formula');
	}

	const f = levelBonus(level);
	const mainHand = Math.floor(2.5 * f) + Math.floor(9.6 * weapon.mainHandTier + bonus);
	const offHandMainHandEquivalent =
		Math.floor(2.5 * f) + Math.floor(9.6 * weapon.offHandTier + bonus);
	const offHand = offHandAd(offHandMainHandEquivalent);
	return { mainHand, offHand, total: mainHand + offHand };
}

/**
 * Computes a player's ability damage (AD) for the given combat style and loadout.
 *
 * AD = AD_mh + AD_oh when dual wielding, or AD_2h when using a two-handed weapon.
 */
export function calculateAbilityDamage(input: AbilityDamageInput): AbilityDamageResult {
	const { style, weapon, level, bonus, styleTier } = input;

	if (style === 'necromancy') {
		return necromancyAd(level, weapon, bonus);
	}

	return styleAd(level, weapon, bonus, styleTier);
}

/**
 * Applies an ability's documented min/max ability-damage multipliers to a computed AD total,
 * e.g. Rend's max hit is 1.65x AD and min hit is 1.35x AD.
 */
export function abilityHitRange(
	abilityDamage: number,
	minMultiplier: number,
	maxMultiplier: number
): { min: number; max: number } {
	return {
		min: Math.floor(abilityDamage * minMultiplier),
		max: Math.floor(abilityDamage * maxMultiplier)
	};
}
