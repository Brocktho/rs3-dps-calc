import { z } from 'zod';

/**
 * 'offHand' items are dedicated off-hand-only weapons (e.g. Off-hand chaotic claw) -- distinct
 * from 'oneHanded' items, which occupy the Main Hand slot. A one-handed main-hand weapon and an
 * off-hand weapon can be worn together; a 'twoHanded' weapon occupies both slots by itself.
 */
export const weaponSlotSchema = z.enum(['oneHanded', 'twoHanded', 'offHand']);
export const attackStyleSchema = z.enum([
	'Arrow',
	'Bolt',
	'Thrown',
	'Slash',
	'Stab',
	'Crush',
	'Spell'
]);
export const combatStyleSchema = z.enum(['magic', 'melee', 'ranged', 'necromancy']);

export const weaponSchema = z.object({
	name: z.string().min(1),
	combatStyle: combatStyleSchema,
	attackStyle: attackStyleSchema,
	slot: weaponSlotSchema,
	/** Level requirement to wield, per the weapon's combat skill. */
	level: z.number().int().nonnegative(),
	/**
	 * The `t` input to the ability damage formula. This is the item's `damageTier` from its
	 * Infobox Bonuses when present, NOT its general `tier` field -- some items (e.g.
	 * Masterwork bow: tier 99, damageTier 100) have these diverge, and ability damage uses
	 * damageTier. Falls back to `tier` when no separate damageTier is set. 0 for cosmetic/quest
	 * prop "weapons" with no real combat use (delivery parcels, novelty surfboards) that
	 * genuinely have `tier = 0` on the wiki.
	 */
	tier: z.number().nonnegative(),
	/** Raw damage stat shown in-game, e.g. "Damage: 1,275 (Tier 100)". */
	damage: z.number().nonnegative(),
	/** 0 for cosmetic/novelty "weapons" with no real accuracy stat on the wiki (see `tier`). */
	accuracy: z.number().nonnegative(),
	/**
	 * The tier shown alongside Accuracy in-game, e.g. "Accuracy: 3,100 (Tier 100)". Distinct
	 * from `tier` (the damage tier) -- they diverge for some items, e.g. Seercull has
	 * damage tier 50 but accuracy tier 52. 0 for the same cosmetic/prop items as `tier`.
	 */
	accuracyTier: z.number().nonnegative(),
	membersOnly: z.boolean(),
	/** Path under /weapon-icons relative to the static root. */
	iconPath: z.string().min(1)
});

export const weaponsFileSchema = z.array(weaponSchema);

export type WeaponJson = z.infer<typeof weaponSchema>;
