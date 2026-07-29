import { z } from 'zod';
import { combatStyleSchema } from './weapons.schema';

export const armourSlotSchema = z.enum([
	'head',
	'torso',
	'legs',
	'hands',
	'feet',
	'offHand',
	'cape',
	'neck',
	'ring',
	'pocket'
]);
export const armourTypeSchema = z.enum(['tank', 'power', 'shield']);

export const armourSchema = z.object({
	name: z.string().min(1),
	/** The armour set this piece belongs to, e.g. "Torva armour". Standalone accessories
	 *  (capes, jewelry) use their own name as the set name. */
	setName: z.string().min(1),
	/**
	 * This piece's own position on the combat triangle (the wiki's Infobox Bonuses `class`
	 * field), used only for the Hybrid Nerf accuracy penalty -- distinct from which style(s)
	 * it grants a damage bonus to. `null` for items with no triangle position at all (the
	 * hybrid jewelry pieces and the igneous Kal-Zuk cape, whose `class` is `hybrid`/`All`):
	 * these are exempt from the Hybrid Nerf regardless of wielded weapon, since they aren't
	 * melee/ranged/magic-specific gear.
	 */
	armourClass: combatStyleSchema.nullable(),
	slot: armourSlotSchema,
	type: armourTypeSchema,
	/** Level requirement to wear, per Defence. */
	level: z.number().int().nonnegative(),
	/**
	 * The tier that determines this piece's Armour value -- this is the item's `armourTier`
	 * from its Infobox Bonuses when present, NOT its general `tier` field (which is really
	 * the equip-level bracket and can diverge, e.g. Vestments of havoc: tier 95, armourTier
	 * 70). Falls back to `tier` when no separate armourTier is set. Mirrors the
	 * tier/damageTier split on Weapon. Jewelry has no armour value and no armourTier -- its
	 * `tier` here is really the item's `armourDamageTier`, which drives its damage bonus.
	 * 0 for cosmetic-only items with no combat purpose (partyhats, Hallowe'en masks) and a
	 * couple of PvP reward items (e.g. Challenger ring) that genuinely have tier=0 on the wiki
	 * despite granting a real damage bonus.
	 */
	tier: z.number().nonnegative(),
	/**
	 * Armour rating contributed by this piece, as an unrounded fractional value (e.g. 635.9).
	 * RS3 only floors the FINAL summed total across all equipped pieces, not each piece
	 * individually -- floor a single piece's own value for display, but sum raw fractional
	 * values first when combining multiple pieces, then floor once at the end. Flooring each
	 * piece before summing undercounts the total by up to 1 per extra fractional piece.
	 * Zero for jewelry, which has no armour stat.
	 */
	armour: z.number().nonnegative(),
	/** Life points bonus, if any (Tank armour only). Always a whole number. */
	lifeBonus: z.number().int().nonnegative(),
	/** Prayer bonus, if any. Always a whole number. Negative for the rare cursed/drawback item
	 *  (e.g. Amulet of zealots: -5, trading a prayer penalty for another benefit). */
	prayerBonus: z.number().int(),
	/**
	 * Per-style combat damage bonus, matching the wiki's own per-style fields (Strength
	 * Bonus/Ranged Bonus/Magic Bonus/Necromancy Bonus) rather than a single value tied to
	 * one combat style. Most armour only sets one of these (its own combat style); hybrid
	 * items (igneous Kal-Zuk, jewelry) set several simultaneously, matching how the game
	 * itself grants a bonus per style rather than a single generic "damage bonus". Each
	 * unrounded fractional value follows the same floor-per-piece-then-sum rule as `armour`.
	 */
	strengthBonus: z.number().nonnegative(),
	rangedBonus: z.number().nonnegative(),
	magicBonus: z.number().nonnegative(),
	necromancyBonus: z.number().nonnegative(),
	membersOnly: z.boolean(),
	/** Path under /armour-icons relative to the static root. */
	iconPath: z.string().min(1)
});

export const armourFileSchema = z.array(armourSchema);

export type ArmourJson = z.infer<typeof armourSchema>;
