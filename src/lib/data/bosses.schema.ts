import { z } from 'zod';

export const bossSchema = z.object({
	name: z.string().min(1),
	/** Combat level shown on the wiki, e.g. 7000 for Nex, Angel of Death. */
	combatLevel: z.number().int().nonnegative(),
	/** Life points. null for the rare boss with no fixed life pool (e.g. Arch-Glacor, whose
	 *  health scales with an in-fight mechanic rather than a flat number). 0 shows up for a
	 *  handful of non-combat-relevant NPCs (training dummies, some event/quest NPCs) whose
	 *  wiki page lists lifepoints=0 verbatim. */
	lifePoints: z.number().nonnegative().nullable(),
	/** Armour rating. 0 for the many minor/novelty NPCs (event monsters, training dummies,
	 *  random-event NPCs) whose wiki page has no combat-stat infobox fields at all. */
	armour: z.number().nonnegative(),
	/** Defence level. 0 for the same minor/novelty NPC cases as `armour`. */
	defenceLevel: z.number().nonnegative(),
	/** Named weakness shown in-game, e.g. "Bolts", "Fire". null if "None"/"Nothing". */
	weakness: z.string().min(1).nullable(),
	/** Affinity (hit chance %) against the named weakness above. Normally 0-100, but a
	 *  handful of removed/special-event bosses (e.g. Zamorakian siege beast, a removed Battle
	 *  of Lumbridge NPC) have wiki-listed values above 100 verbatim -- not a scraping bug. */
	affinityWeakness: z.number().nonnegative(),
	/** Affinity (hit chance %) against each general combat style. Same >100 caveat as above. */
	affinityMelee: z.number().nonnegative(),
	affinityRanged: z.number().nonnegative(),
	affinityMagic: z.number().nonnegative(),
	/** The boss's own max hit per style, for reference (0 if it doesn't use that style).
	 *  A handful of joke/novelty NPCs (e.g. Turkey, Bunny) have a negative value verbatim
	 *  from the wiki -- kept as-is rather than clamped, since it's the actual scraped source
	 *  value for what is a non-serious NPC anyway. */
	maxHitMelee: z.number(),
	maxHitRanged: z.number(),
	maxHitMagic: z.number(),
	maxHitNecromancy: z.number(),
	/** The boss's own accuracy per style, for reference. Same negative-value caveat as above. */
	accuracyMelee: z.number(),
	accuracyRanged: z.number(),
	accuracyMagic: z.number(),
	accuracyNecromancy: z.number(),
	/** Combat styles the boss attacks with, e.g. ['melee', 'ranged']. Kept as raw lowercase
	 *  strings rather than the player-facing CombatStyle type -- a couple of bosses (dragons)
	 *  have a "dragonfire" style with no equivalent in that type. */
	attackStyles: z.array(z.string().min(1)),
	immuneToPoison: z.boolean(),
	immuneToStun: z.boolean(),
	immuneToDeflect: z.boolean(),
	immuneToDrain: z.boolean(),
	/** Path under /boss-icons relative to the static root. */
	iconPath: z.string().min(1)
});

export const bossesFileSchema = z.array(bossSchema);

export type BossJson = z.infer<typeof bossSchema>;
