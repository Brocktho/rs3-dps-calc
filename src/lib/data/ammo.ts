export type AmmoAttackStyle = 'Arrow' | 'Bolt';

export interface Ammo {
	name: string;
	attackStyle: AmmoAttackStyle;
	/** Level requirement to use, per Ranged. */
	level: number;
	/**
	 * The `a` input to the ability damage formula. This is the item's `damageTier` from its
	 * Infobox Bonuses when present, NOT its general `tier` field -- several "god" arrows
	 * (Bik, Wen, Ful, Jas demonbane/dragonbane) have tier 95 but damageTier 100. Falls back
	 * to `tier` when no separate damageTier is set.
	 */
	tier: number;
	/** Raw damage stat shown in-game, e.g. "Damage: 960 (Tier 100)". */
	damage: number;
	/** Path under /ammo-icons relative to the static root. */
	iconPath: string;
}

/**
 * A curated set of the highest-tier ammunition, scraped from individual item pages
 * (see runescape.wiki/w/Category:Ammunition for the full ~180-item list, most of which
 * is lower-tier and not included here). Bakriminel bolts are represented by the base
 * (gemless) bolt plus the top-tier Hydrix variant (plain and enchanted), rather than all
 * 11 gem types.
 */
export const ammo: Ammo[] = [
	{
		name: 'Bakriminel bolts',
		attackStyle: 'Bolt',
		level: 80,
		tier: 75,
		damage: 720,
		iconPath: '/ammo-icons/bakriminel-bolts.png'
	},
	{
		name: 'Hydrix bakriminel bolts',
		attackStyle: 'Bolt',
		level: 90,
		tier: 85,
		damage: 816,
		iconPath: '/ammo-icons/hydrix-bakriminel-bolts.png'
	},
	{
		name: 'Hydrix bakriminel bolts (e)',
		attackStyle: 'Bolt',
		level: 99,
		tier: 95,
		damage: 912,
		iconPath: '/ammo-icons/hydrix-bakriminel-bolts-e.png'
	},
	{
		name: 'Dinarrow',
		attackStyle: 'Arrow',
		level: 95,
		tier: 95,
		damage: 912,
		iconPath: '/ammo-icons/dinarrow.png'
	},
	{
		name: 'Jas demonbane arrow',
		attackStyle: 'Arrow',
		level: 95,
		tier: 100,
		damage: 960,
		iconPath: '/ammo-icons/jas-demonbane-arrow.png'
	},
	{
		name: 'Jas dragonbane arrow',
		attackStyle: 'Arrow',
		level: 95,
		tier: 100,
		damage: 960,
		iconPath: '/ammo-icons/jas-dragonbane-arrow.png'
	},
	{
		name: 'Ful arrow',
		attackStyle: 'Arrow',
		level: 95,
		tier: 100,
		damage: 960,
		iconPath: '/ammo-icons/ful-arrow.png'
	},
	{
		name: 'Wen arrow',
		attackStyle: 'Arrow',
		level: 95,
		tier: 100,
		damage: 960,
		iconPath: '/ammo-icons/wen-arrow.png'
	},
	{
		name: 'Bik arrow',
		attackStyle: 'Arrow',
		level: 95,
		tier: 100,
		damage: 960,
		iconPath: '/ammo-icons/bik-arrow.png'
	},
	{
		name: 'Araxyte arrow',
		attackStyle: 'Arrow',
		level: 90,
		tier: 90,
		damage: 864,
		iconPath: '/ammo-icons/araxyte-arrow.png'
	},
	{
		name: 'Ascension bolts',
		attackStyle: 'Bolt',
		level: 90,
		tier: 90,
		damage: 864,
		iconPath: '/ammo-icons/ascension-bolts.png'
	}
];
