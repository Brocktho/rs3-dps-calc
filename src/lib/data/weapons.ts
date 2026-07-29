import type { CombatStyle } from '../formulas/abilityDamage';
import { loadJson } from './loadJson';
import { weaponsFileSchema } from './weapons.schema';
import weaponsJson from './json/weapons.json';

/**
 * 'offHand' items are dedicated off-hand-only weapons (e.g. Off-hand chaotic claw) -- distinct
 * from 'oneHanded' items, which occupy the Main Hand slot. A one-handed main-hand weapon and an
 * off-hand weapon can be worn together; a 'twoHanded' weapon occupies both slots by itself.
 */
export type WeaponSlot = 'oneHanded' | 'twoHanded' | 'offHand';
export type AttackStyle = 'Arrow' | 'Bolt' | 'Thrown' | 'Slash' | 'Stab' | 'Crush' | 'Spell';

export interface Weapon {
	name: string;
	combatStyle: CombatStyle;
	attackStyle: AttackStyle;
	slot: WeaponSlot;
	/** Level requirement to wield, per the weapon's combat skill. */
	level: number;
	/**
	 * The `t` input to the ability damage formula. This is the item's `damageTier` from its
	 * Infobox Bonuses when present, NOT its general `tier` field -- some items (e.g.
	 * Masterwork bow: tier 99, damageTier 100) have these diverge, and ability damage uses
	 * damageTier. Falls back to `tier` when no separate damageTier is set.
	 */
	tier: number;
	/** Raw damage stat shown in-game, e.g. "Damage: 1,275 (Tier 100)". */
	damage: number;
	accuracy: number;
	/**
	 * The tier shown alongside Accuracy in-game, e.g. "Accuracy: 3,100 (Tier 100)". Distinct
	 * from `tier` (the damage tier) -- they diverge for some items, e.g. Seercull has
	 * damage tier 50 but accuracy tier 52.
	 */
	accuracyTier: number;
	membersOnly: boolean;
	/** Path under /weapon-icons relative to the static root. */
	iconPath: string;
}

/**
 * Representative sample of weapons spanning the level/tier range for each combat style,
 * scraped from runescape.wiki/w/Weapon/Ranged_weapons, Melee_weapons, and Magic_weapons
 * (roster + level/accuracy) cross-referenced with each weapon's own page for its exact
 * tier (Infobox Bonuses). Items with multiple upgrade versions use the highest version's stats.
 * This is NOT the full weapon roster -- see weaponRosterCounts for total counts per category.
 *
 * Backed by json/weapons.json, validated against weapons.schema.ts at import time.
 */
export const weapons: Weapon[] = loadJson(weaponsJson, weaponsFileSchema, 'json/weapons.json');

/** Total weapon counts found on each list page, for reference (full rosters not yet scraped). */
export const weaponRosterCounts = {
	ranged: 304,
	melee: 112,
	magic: 139
};
