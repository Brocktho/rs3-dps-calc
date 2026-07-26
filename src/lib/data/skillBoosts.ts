export type BoostableSkill = 'attack' | 'strength' | 'defence' | 'ranged' | 'magic' | 'necromancy';

export interface SkillBoost {
	name: string;
	/** Skills this boost applies to when active. */
	skills: BoostableSkill[];
	/** Percentage term of the boost formula, e.g. 17 for Elder overload's 17%. */
	pct: number;
	/** Flat term of the boost formula, e.g. 5 for Elder overload's +5. */
	flat: number;
	/** Path under /boost-icons relative to the static root. */
	iconPath: string;
}

/**
 * Temporary skill boosts from https://runescape.wiki/w/Temporary_skill_boost, restricted to
 * the Super/Extreme/Supreme single-skill potions and the Overload family (all 6 combat
 * skills at once). Every named variant is listed separately even when several share an
 * identical formula (e.g. Overload/Holy overload/Searing overload/Overload salve/
 * Aggroverload/Holy aggroverload are all 15%+3 on all 6 skills -- they only differ by
 * cosmetic side effects like prayer restore or dragonfire protection that don't matter here).
 * Deliberately excludes Super Saradomin brew (6%+1, an off-tier formula) and Super Zamorak
 * brew (12%+2 but also drains Defence/life, a mechanic this calculator doesn't model).
 *
 * Boosted level = level + floor(pct/100 * level) + flat, per
 * https://runescape.wiki/w/Temporary_skill_boost ("List of boosts affecting multiple
 * skills"/"List of boosts affecting a single skill" tables, "rounded down"). Confirmed
 * against the user's own worked example: Elder overload = 1.17 * level + 5 (equivalently,
 * level + floor(0.17 * level) + 5 -- see applyBoost in formulas/skillBoost.ts).
 */
export const skillBoosts: SkillBoost[] = [
	// Elder overload, then Supreme overload, then regular Overload -- highest tier first, per
	// user preference, since these are the boosts most players reach for.
	{
		name: 'Elder overload potion',
		skills: ['attack', 'strength', 'defence', 'magic', 'ranged', 'necromancy'],
		pct: 17,
		flat: 5,
		iconPath: '/boost-icons/elder-overload-potion.png'
	},
	{
		name: 'Elder overload salve',
		skills: ['attack', 'strength', 'defence', 'magic', 'ranged', 'necromancy'],
		pct: 17,
		flat: 5,
		iconPath: '/boost-icons/elder-overload-salve.png'
	},
	{
		name: 'Supreme overload potion',
		skills: ['attack', 'strength', 'defence', 'magic', 'ranged', 'necromancy'],
		pct: 16,
		flat: 4,
		iconPath: '/boost-icons/supreme-overload-potion.png'
	},
	{
		name: 'Supreme overload salve',
		skills: ['attack', 'strength', 'defence', 'magic', 'ranged', 'necromancy'],
		pct: 16,
		flat: 4,
		iconPath: '/boost-icons/supreme-overload-salve.png'
	},
	{
		name: 'Overload',
		skills: ['attack', 'strength', 'defence', 'magic', 'ranged', 'necromancy'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/overload.png'
	},
	{
		name: 'Holy overload potion',
		skills: ['attack', 'strength', 'defence', 'magic', 'ranged', 'necromancy'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/holy-overload-potion.png'
	},
	{
		name: 'Searing overload potion',
		skills: ['attack', 'strength', 'defence', 'magic', 'ranged', 'necromancy'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/searing-overload-potion.png'
	},
	{
		name: 'Overload salve',
		skills: ['attack', 'strength', 'defence', 'magic', 'ranged', 'necromancy'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/overload-salve.png'
	},
	{
		name: 'Aggroverload',
		skills: ['attack', 'strength', 'defence', 'magic', 'ranged', 'necromancy'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/aggroverload.png'
	},
	{
		name: 'Holy aggroverload',
		skills: ['attack', 'strength', 'defence', 'magic', 'ranged', 'necromancy'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/holy-aggroverload.png'
	},
	{
		name: 'Super melee potion',
		skills: ['attack', 'strength', 'defence'],
		pct: 12,
		flat: 2,
		iconPath: '/boost-icons/super-melee-potion.png'
	},
	{
		name: "Super warmaster's potion",
		skills: ['attack', 'strength', 'defence', 'magic', 'ranged', 'necromancy'],
		pct: 12,
		flat: 2,
		iconPath: '/boost-icons/super-warmaster-s-potion.png'
	},
	{
		name: "Extreme brawler's potion",
		skills: ['attack', 'strength', 'defence'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/extreme-brawler-s-potion.png'
	},
	{
		name: "Extreme battlemage's potion",
		skills: ['magic', 'defence'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/extreme-battlemage-s-potion.png'
	},
	{
		name: "Extreme sharpshooter's potion",
		skills: ['ranged', 'defence'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/extreme-sharpshooter-s-potion.png'
	},
	{
		name: "Extreme warmaster's potion",
		skills: ['attack', 'strength', 'defence', 'magic', 'ranged', 'necromancy'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/extreme-warmaster-s-potion.png'
	},
	{
		name: 'Super attack',
		skills: ['attack'],
		pct: 12,
		flat: 2,
		iconPath: '/boost-icons/super-attack.png'
	},
	{
		name: 'Extreme attack',
		skills: ['attack'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/extreme-attack.png'
	},
	{
		name: 'Supreme attack potion',
		skills: ['attack'],
		pct: 16,
		flat: 4,
		iconPath: '/boost-icons/supreme-attack-potion.png'
	},
	{
		name: 'Super defence',
		skills: ['defence'],
		pct: 12,
		flat: 2,
		iconPath: '/boost-icons/super-defence.png'
	},
	{
		name: 'Extreme defence',
		skills: ['defence'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/extreme-defence.png'
	},
	{
		name: 'Supreme defence potion',
		skills: ['defence'],
		pct: 16,
		flat: 4,
		iconPath: '/boost-icons/supreme-defence-potion.png'
	},
	{
		name: 'Super magic potion',
		skills: ['magic'],
		pct: 12,
		flat: 2,
		iconPath: '/boost-icons/super-magic-potion.png'
	},
	{
		name: 'Extreme magic',
		skills: ['magic'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/extreme-magic.png'
	},
	{
		name: 'Supreme magic potion',
		skills: ['magic'],
		pct: 16,
		flat: 4,
		iconPath: '/boost-icons/supreme-magic-potion.png'
	},
	{
		name: 'Super necromancy',
		skills: ['necromancy'],
		pct: 12,
		flat: 2,
		iconPath: '/boost-icons/super-necromancy.png'
	},
	{
		name: 'Extreme necromancy',
		skills: ['necromancy'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/extreme-necromancy.png'
	},
	{
		name: 'Super ranging potion',
		skills: ['ranged'],
		pct: 12,
		flat: 2,
		iconPath: '/boost-icons/super-ranging-potion.png'
	},
	{
		name: 'Extreme ranging',
		skills: ['ranged'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/extreme-ranging.png'
	},
	{
		name: 'Supreme ranging potion',
		skills: ['ranged'],
		pct: 16,
		flat: 4,
		iconPath: '/boost-icons/supreme-ranging-potion.png'
	},
	{
		name: 'Super strength',
		skills: ['strength'],
		pct: 12,
		flat: 2,
		iconPath: '/boost-icons/super-strength.png'
	},
	{
		name: 'Extreme strength',
		skills: ['strength'],
		pct: 15,
		flat: 3,
		iconPath: '/boost-icons/extreme-strength.png'
	},
	{
		name: 'Supreme strength potion',
		skills: ['strength'],
		pct: 16,
		flat: 4,
		iconPath: '/boost-icons/supreme-strength-potion.png'
	}
];
