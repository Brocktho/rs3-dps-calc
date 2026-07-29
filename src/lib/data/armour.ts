import type { CombatStyle } from '../formulas/abilityDamage';
import { loadJson } from './loadJson';
import { armourFileSchema } from './armour.schema';
import armourJson from './json/armour.json';

export type ArmourSlot =
	'head' | 'torso' | 'legs' | 'hands' | 'feet' | 'offHand' | 'cape' | 'neck' | 'ring' | 'pocket';
export type ArmourType = 'tank' | 'power' | 'shield';

export interface Armour {
	name: string;
	/** The armour set this piece belongs to, e.g. "Torva armour". Standalone accessories
	 *  (capes, jewelry) use their own name as the set name. */
	setName: string;
	/**
	 * This piece's own position on the combat triangle (the wiki's Infobox Bonuses `class`
	 * field), used only for the Hybrid Nerf accuracy penalty -- distinct from which style(s)
	 * it grants a damage bonus to. `null` for items with no triangle position at all (the
	 * hybrid jewelry pieces and the igneous Kal-Zuk cape, whose `class` is `hybrid`/`All`):
	 * these are exempt from the Hybrid Nerf regardless of wielded weapon, since they aren't
	 * melee/ranged/magic-specific gear.
	 */
	armourClass: CombatStyle | null;
	slot: ArmourSlot;
	type: ArmourType;
	/** Level requirement to wear, per Defence. */
	level: number;
	/**
	 * The tier that determines this piece's Armour value -- this is the item's `armourTier`
	 * from its Infobox Bonuses when present, NOT its general `tier` field (which is really
	 * the equip-level bracket and can diverge, e.g. Vestments of havoc: tier 95, armourTier
	 * 70). Falls back to `tier` when no separate armourTier is set. Mirrors the
	 * tier/damageTier split on Weapon. Jewelry has no armour value and no armourTier -- its
	 * `tier` here is really the item's `armourDamageTier`, which drives its damage bonus.
	 */
	tier: number;
	/**
	 * Armour rating contributed by this piece, as an unrounded fractional value (e.g. 635.9).
	 * RS3 only floors the FINAL summed total across all equipped pieces, not each piece
	 * individually -- floor a single piece's own value for display, but sum raw fractional
	 * values first when combining multiple pieces, then floor once at the end. Flooring each
	 * piece before summing undercounts the total by up to 1 per extra fractional piece.
	 * Zero for jewelry, which has no armour stat.
	 */
	armour: number;
	/** Life points bonus, if any (Tank armour only). Always a whole number. */
	lifeBonus: number;
	/** Prayer bonus, if any. Always a whole number. */
	prayerBonus: number;
	/**
	 * Per-style combat damage bonus, matching the wiki's own per-style fields (Strength
	 * Bonus/Ranged Bonus/Magic Bonus/Necromancy Bonus) rather than a single value tied to
	 * one combat style. Most armour only sets one of these (its own combat style); hybrid
	 * items (igneous Kal-Zuk, jewelry) set several simultaneously, matching how the game
	 * itself grants a bonus per style rather than a single generic "damage bonus". Each
	 * unrounded fractional value follows the same floor-per-piece-then-sum rule as `armour`.
	 */
	strengthBonus: number;
	rangedBonus: number;
	magicBonus: number;
	necromancyBonus: number;
	membersOnly: boolean;
	/** Path under /armour-icons relative to the static root. */
	iconPath: string;
}

/**
 * All t90+ armour pieces from runescape.wiki/w/Armour's Tank and Power tier tables (Hybrid
 * and All armour have no sets at t90+), plus Torva/Virtus/Pernix (Nex armour), which aren't
 * listed in those tables but are well-known t90 sets. Each piece scraped from its own page's
 * Infobox Bonuses. This is NOT the full armour roster -- only t90 and above.
 *
 * Also includes standalone high-tier accessories: Jaws of the Abyss (head), the five igneous
 * Kal capes, and top-tier neck/ring jewelry (Essence of Finality amulet, Reaper necklace,
 * Amulet of souls, Amulet of glory, Asylum surgeon's ring, Ring of death, Reaver's ring).
 * These items generally have no separate armourTier (their `tier` here is the item's
 * armourDamageTier, which drives their damage bonus) and no wear-level requirement
 * (`level: 0`), unlike Defence-gated armour sets.
 *
 * Backed by json/armour.json, validated against armour.schema.ts at import time.
 */
export const armour: Armour[] = loadJson(armourJson, armourFileSchema, 'json/armour.json');
