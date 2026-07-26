import type { CombatStyle } from '../formulas/abilityDamage';

/** A prayer/curse can occupy one or more of these slots at once (e.g. Piety occupies all
 *  three; Eagle Eye occupies only 'accuracy'). Only one selection is allowed per slot -- see
 *  formulas/prayer.ts for the mutual-exclusion logic. */
export type PrayerSlot = 'accuracy' | 'damage' | 'armour';

export interface Prayer {
	name: string;
	/** True for Ancient Curses, false for standard Prayers. The player can only have one or
	 *  the other unlocked at a time in-game. */
	isCurse: boolean;
	level: number;
	slots: PrayerSlot[];
	/** The combat style this prayer boosts. null for Divine Rage, which boosts all four
	 *  styles' damage simultaneously. */
	style: CombatStyle | null;
	/**
	 * Virtual levels added to the base skill level before the accuracy formula's f(x) is
	 * applied -- same mechanism as temporary skill boosts (confirmed via
	 * runescape.wiki/w/Hit_chance's accuracy table, which lists prayers like Turmoil/Piety
	 * alongside overloads in the same "Level accuracy bonus" column). 0 if this prayer has no
	 * accuracy component.
	 */
	accuracyLevelBonus: number;
	/**
	 * Percentage damage bonus. Per runescape.wiki/w/Ability_damage, Prayer's damage bonus is
	 * MULTIPLICATIVE on the final ability damage total -- distinct from equipment's damage
	 * bonus, which is additive inside the ability-damage formula itself. Apply as
	 * `total *= 1 + damagePercentBonus/100` after calculateAbilityDamage() runs, not folded
	 * into the `bonus` parameter. 0 if this prayer has no damage component.
	 */
	damagePercentBonus: number;
	/** Virtual levels added to Defence before the armour-rating formula's f(x) is applied.
	 *  Not yet wired into any calculation (no player-defense feature exists yet) -- captured
	 *  for future use. 0 if this prayer has no armour component. */
	armourLevelBonus: number;
	/** Path under /prayer-icons relative to the static root. */
	iconPath: string;
}

/**
 * Damaging prayers/curses only, scraped from runescape.wiki/w/Prayers and
 * runescape.wiki/w/Ancient_Curses (both Lua-module-generated tables with no static wikitext,
 * fetched via rendered HTML) -- i.e. prayers that boost accuracy, ability damage %, or
 * armour rating. Excludes purely defensive/utility prayers (Protect from Magic, Redemption,
 * Smite, Rapid Renewal, etc.) and curses with no player-facing buff (the "Sap" family only
 * debuffs the enemy, with no self-buff at all).
 *
 * "Leech" curses (Ancient Curses' mid-tier accuracy/damage/armour boosts) have a value that
 * scales with consecutive hits, e.g. Leech Melee Strength ranges +2% to +8% damage -- stored
 * here at their MAXIMUM value (a fully-stacked curse in sustained combat), per user decision.
 * The top-tier combo curses (Torment/Anguish/Sorrow/Turmoil/Ruination/Desolation/Malevolence/
 * Affliction) also drain the enemy's own accuracy/armour/damage, but only the player-facing
 * self-buff is modeled here -- the enemy-debuff side isn't applied to the selected boss's
 * stats yet.
 */
export const prayers: Prayer[] = [
	// --- Standard Prayers: Defence (armour) ---
	{
		name: 'Thick Skin',
		isCurse: false,
		level: 1,
		slots: ['armour'],
		style: null,
		accuracyLevelBonus: 0,
		damagePercentBonus: 0,
		armourLevelBonus: 2,
		iconPath: '/prayer-icons/thick-skin.png'
	},
	{
		name: 'Rock Skin',
		isCurse: false,
		level: 10,
		slots: ['armour'],
		style: null,
		accuracyLevelBonus: 0,
		damagePercentBonus: 0,
		armourLevelBonus: 4,
		iconPath: '/prayer-icons/rock-skin.png'
	},
	{
		name: 'Steel Skin',
		isCurse: false,
		level: 28,
		slots: ['armour'],
		style: null,
		accuracyLevelBonus: 0,
		damagePercentBonus: 0,
		armourLevelBonus: 6,
		iconPath: '/prayer-icons/steel-skin.png'
	},

	// --- Standard Prayers: Melee ---
	{
		name: 'Clarity of Thought',
		isCurse: false,
		level: 7,
		slots: ['accuracy'],
		style: 'melee',
		accuracyLevelBonus: 2,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/clarity-of-thought.png'
	},
	{
		name: 'Improved Reflexes',
		isCurse: false,
		level: 16,
		slots: ['accuracy'],
		style: 'melee',
		accuracyLevelBonus: 4,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/improved-reflexes.png'
	},
	{
		name: 'Incredible Reflexes',
		isCurse: false,
		level: 34,
		slots: ['accuracy'],
		style: 'melee',
		accuracyLevelBonus: 6,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/incredible-reflexes.png'
	},
	{
		name: 'Burst of Strength',
		isCurse: false,
		level: 4,
		slots: ['damage'],
		style: 'melee',
		accuracyLevelBonus: 0,
		damagePercentBonus: 2,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/burst-of-strength.png'
	},
	{
		name: 'Superhuman Strength',
		isCurse: false,
		level: 13,
		slots: ['damage'],
		style: 'melee',
		accuracyLevelBonus: 0,
		damagePercentBonus: 4,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/superhuman-strength.png'
	},
	{
		name: 'Ultimate Strength',
		isCurse: false,
		level: 31,
		slots: ['damage'],
		style: 'melee',
		accuracyLevelBonus: 0,
		damagePercentBonus: 6,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/ultimate-strength.png'
	},
	{
		name: 'Chivalry',
		isCurse: false,
		level: 60,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'melee',
		accuracyLevelBonus: 7,
		damagePercentBonus: 7,
		armourLevelBonus: 7,
		iconPath: '/prayer-icons/chivalry.png'
	},
	{
		name: 'Piety',
		isCurse: false,
		level: 70,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'melee',
		accuracyLevelBonus: 8,
		damagePercentBonus: 8,
		armourLevelBonus: 8,
		iconPath: '/prayer-icons/piety.png'
	},

	// --- Standard Prayers: Ranged ---
	{
		name: 'Sharp Eye',
		isCurse: false,
		level: 8,
		slots: ['accuracy'],
		style: 'ranged',
		accuracyLevelBonus: 2,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/sharp-eye.png'
	},
	{
		name: 'Hawk Eye',
		isCurse: false,
		level: 26,
		slots: ['accuracy'],
		style: 'ranged',
		accuracyLevelBonus: 4,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/hawk-eye.png'
	},
	{
		name: 'Eagle Eye',
		isCurse: false,
		level: 44,
		slots: ['accuracy'],
		style: 'ranged',
		accuracyLevelBonus: 6,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/eagle-eye.png'
	},
	{
		name: 'Unstoppable Force',
		isCurse: false,
		level: 8,
		slots: ['damage'],
		style: 'ranged',
		accuracyLevelBonus: 0,
		damagePercentBonus: 2,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/unstoppable-force.png'
	},
	{
		name: 'Unrelenting Force',
		isCurse: false,
		level: 26,
		slots: ['damage'],
		style: 'ranged',
		accuracyLevelBonus: 0,
		damagePercentBonus: 4,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/unrelenting-force.png'
	},
	{
		name: 'Overpowering Force',
		isCurse: false,
		level: 44,
		slots: ['damage'],
		style: 'ranged',
		accuracyLevelBonus: 0,
		damagePercentBonus: 6,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/overpowering-force.png'
	},
	{
		name: 'Rigour',
		isCurse: false,
		level: 70,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'ranged',
		accuracyLevelBonus: 8,
		damagePercentBonus: 8,
		armourLevelBonus: 8,
		iconPath: '/prayer-icons/rigour.png'
	},

	// --- Standard Prayers: Magic ---
	{
		name: 'Mystic Will',
		isCurse: false,
		level: 9,
		slots: ['accuracy'],
		style: 'magic',
		accuracyLevelBonus: 2,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/mystic-will.png'
	},
	{
		name: 'Mystic Lore',
		isCurse: false,
		level: 27,
		slots: ['accuracy'],
		style: 'magic',
		accuracyLevelBonus: 4,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/mystic-lore.png'
	},
	{
		name: 'Mystic Might',
		isCurse: false,
		level: 45,
		slots: ['accuracy'],
		style: 'magic',
		accuracyLevelBonus: 6,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/mystic-might.png'
	},
	{
		name: 'Charge',
		isCurse: false,
		level: 9,
		slots: ['damage'],
		style: 'magic',
		accuracyLevelBonus: 0,
		damagePercentBonus: 2,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/charge.png'
	},
	{
		name: 'Super Charge',
		isCurse: false,
		level: 27,
		slots: ['damage'],
		style: 'magic',
		accuracyLevelBonus: 0,
		damagePercentBonus: 4,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/super-charge.png'
	},
	{
		name: 'Overcharge',
		isCurse: false,
		level: 45,
		slots: ['damage'],
		style: 'magic',
		accuracyLevelBonus: 0,
		damagePercentBonus: 6,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/overcharge.png'
	},
	{
		name: 'Augury',
		isCurse: false,
		level: 70,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'magic',
		accuracyLevelBonus: 8,
		damagePercentBonus: 8,
		armourLevelBonus: 8,
		iconPath: '/prayer-icons/augury.png'
	},

	// --- Standard Prayers: Necromancy ---
	{
		name: 'Hand of Judgement',
		isCurse: false,
		level: 10,
		slots: ['accuracy'],
		style: 'necromancy',
		accuracyLevelBonus: 2,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/hand-of-judgement.png'
	},
	{
		name: 'Hand of Fate',
		isCurse: false,
		level: 28,
		slots: ['accuracy'],
		style: 'necromancy',
		accuracyLevelBonus: 4,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/hand-of-fate.png'
	},
	{
		name: 'Hand of Doom',
		isCurse: false,
		level: 46,
		slots: ['accuracy'],
		style: 'necromancy',
		accuracyLevelBonus: 6,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/hand-of-doom.png'
	},
	{
		name: 'Decay',
		isCurse: false,
		level: 10,
		slots: ['damage'],
		style: 'necromancy',
		accuracyLevelBonus: 0,
		damagePercentBonus: 2,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/decay.png'
	},
	{
		name: 'Hastened Decay',
		isCurse: false,
		level: 28,
		slots: ['damage'],
		style: 'necromancy',
		accuracyLevelBonus: 0,
		damagePercentBonus: 4,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/hastened-decay.png'
	},
	{
		name: 'Accelerated Decay',
		isCurse: false,
		level: 46,
		slots: ['damage'],
		style: 'necromancy',
		accuracyLevelBonus: 0,
		damagePercentBonus: 6,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/accelerated-decay.png'
	},
	{
		name: 'Sanctity',
		isCurse: false,
		level: 70,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'necromancy',
		accuracyLevelBonus: 8,
		damagePercentBonus: 8,
		armourLevelBonus: 8,
		iconPath: '/prayer-icons/sanctity.png'
	},

	// --- Standard Prayers: all styles ---
	{
		name: 'Divine Rage',
		isCurse: false,
		level: 85,
		slots: ['damage'],
		style: null,
		accuracyLevelBonus: 0,
		damagePercentBonus: 5,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/divine-rage.png'
	},

	// --- Ancient Curses: Leech (accuracy), max value at full stacks ---
	{
		name: 'Leech Melee Attack',
		isCurse: true,
		level: 74,
		slots: ['accuracy'],
		style: 'melee',
		accuracyLevelBonus: 5,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/leech-melee-attack.png'
	},
	{
		name: 'Leech Ranged Attack',
		isCurse: true,
		level: 76,
		slots: ['accuracy'],
		style: 'ranged',
		accuracyLevelBonus: 5,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/leech-ranged-attack.png'
	},
	{
		name: 'Leech Magic Attack',
		isCurse: true,
		level: 78,
		slots: ['accuracy'],
		style: 'magic',
		accuracyLevelBonus: 5,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/leech-magic-attack.png'
	},
	{
		name: 'Leech Necromancy Attack',
		isCurse: true,
		level: 83,
		slots: ['accuracy'],
		style: 'necromancy',
		accuracyLevelBonus: 5,
		damagePercentBonus: 0,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/leech-necromancy-attack.png'
	},

	// --- Ancient Curses: Leech (damage), max value at full stacks ---
	{
		name: 'Leech Melee Strength',
		isCurse: true,
		level: 82,
		slots: ['damage'],
		style: 'melee',
		accuracyLevelBonus: 0,
		damagePercentBonus: 8,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/leech-melee-strength.png'
	},
	{
		name: 'Leech Ranged Strength',
		isCurse: true,
		level: 77,
		slots: ['damage'],
		style: 'ranged',
		accuracyLevelBonus: 0,
		damagePercentBonus: 8,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/leech-ranged-strength.png'
	},
	{
		name: 'Leech Magic Strength',
		isCurse: true,
		level: 79,
		slots: ['damage'],
		style: 'magic',
		accuracyLevelBonus: 0,
		damagePercentBonus: 8,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/leech-magic-strength.png'
	},
	{
		name: 'Leech Necromancy Strength',
		isCurse: true,
		level: 85,
		slots: ['damage'],
		style: 'necromancy',
		accuracyLevelBonus: 0,
		damagePercentBonus: 8,
		armourLevelBonus: 0,
		iconPath: '/prayer-icons/leech-necromancy-strength.png'
	},

	// --- Ancient Curses: Leech Defence (armour), max value at full stacks ---
	{
		name: 'Leech Defence',
		isCurse: true,
		level: 80,
		slots: ['armour'],
		style: null,
		accuracyLevelBonus: 0,
		damagePercentBonus: 0,
		armourLevelBonus: 5,
		iconPath: '/prayer-icons/leech-defence.png'
	},

	// --- Ancient Curses: top-tier combo (accuracy + damage + armour) ---
	{
		name: 'Turmoil',
		isCurse: true,
		level: 95,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'melee',
		accuracyLevelBonus: 10,
		damagePercentBonus: 10,
		armourLevelBonus: 10,
		iconPath: '/prayer-icons/turmoil.png'
	},
	{
		name: 'Anguish',
		isCurse: true,
		level: 95,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'ranged',
		accuracyLevelBonus: 10,
		damagePercentBonus: 10,
		armourLevelBonus: 10,
		iconPath: '/prayer-icons/anguish.png'
	},
	{
		name: 'Torment',
		isCurse: true,
		level: 95,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'magic',
		accuracyLevelBonus: 10,
		damagePercentBonus: 10,
		armourLevelBonus: 10,
		iconPath: '/prayer-icons/torment.png'
	},
	{
		name: 'Sorrow',
		isCurse: true,
		level: 95,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'necromancy',
		accuracyLevelBonus: 10,
		damagePercentBonus: 10,
		armourLevelBonus: 10,
		iconPath: '/prayer-icons/sorrow.png'
	},
	{
		name: 'Malevolence',
		isCurse: true,
		level: 99,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'melee',
		accuracyLevelBonus: 12,
		damagePercentBonus: 12,
		armourLevelBonus: 12,
		iconPath: '/prayer-icons/malevolence.png'
	},
	{
		name: 'Desolation',
		isCurse: true,
		level: 99,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'ranged',
		accuracyLevelBonus: 12,
		damagePercentBonus: 12,
		armourLevelBonus: 12,
		iconPath: '/prayer-icons/desolation.png'
	},
	{
		name: 'Affliction',
		isCurse: true,
		level: 99,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'magic',
		accuracyLevelBonus: 12,
		damagePercentBonus: 12,
		armourLevelBonus: 12,
		iconPath: '/prayer-icons/affliction.png'
	},
	{
		name: 'Ruination',
		isCurse: true,
		level: 99,
		slots: ['accuracy', 'damage', 'armour'],
		style: 'necromancy',
		accuracyLevelBonus: 12,
		damagePercentBonus: 12,
		armourLevelBonus: 12,
		iconPath: '/prayer-icons/ruination.png'
	}
];
