import { loadJson } from './loadJson';
import { bossesFileSchema } from './bosses.schema';
import bossesJson from './json/bosses.json';

/**
 * Defensive (and basic offensive) stats for RS3 bosses, scraped from each boss's own
 * runescape.wiki page ({{Infobox Monster}}). Covers the "PvM bosses" and "Raids bosses"
 * sections of runescape.wiki/w/Bosses, plus the 8 individual Barrows Brothers (listed under
 * "Minigame bosses" on that page, but a notable boss encounter in their own right).
 *
 * For bosses with multiple combat-phase "versions" (e.g. Normal/Hard mode, or per-style
 * forms), only the FIRST listed version's stats are captured -- confirmed across a sample of
 * ~10 bosses that version1 is consistently the primary/default combat form here (unlike
 * weapons, where version1 sometimes meant a degraded/broken state).
 *
 * Excluded: Croesus and The Gate of Elidinis are "skilling bosses" using {{Infobox NPC}}
 * with no traditional combat stats (no Armour/Defence/affinity) at all -- not a scraping
 * gap, they genuinely don't have these stats on the wiki.
 */

export interface Boss {
	name: string;
	/** Combat level shown on the wiki, e.g. 7000 for Nex, Angel of Death. */
	combatLevel: number;
	/** Life points. null for the rare boss with no fixed life pool (e.g. Arch-Glacor, whose
	 *  health scales with an in-fight mechanic rather than a flat number). */
	lifePoints: number | null;
	/** Armour rating. */
	armour: number;
	/** Defence level. */
	defenceLevel: number;
	/** Named weakness shown in-game, e.g. "Bolts", "Fire". null if "None"/"Nothing". */
	weakness: string | null;
	/** Affinity (hit chance %) against the named weakness above. */
	affinityWeakness: number;
	/** Affinity (hit chance %) against each general combat style. */
	affinityMelee: number;
	affinityRanged: number;
	affinityMagic: number;
	/** The boss's own max hit per style, for reference (0 if it doesn't use that style). */
	maxHitMelee: number;
	maxHitRanged: number;
	maxHitMagic: number;
	maxHitNecromancy: number;
	/** The boss's own accuracy per style, for reference. */
	accuracyMelee: number;
	accuracyRanged: number;
	accuracyMagic: number;
	accuracyNecromancy: number;
	/** Combat styles the boss attacks with, e.g. ['melee', 'ranged']. Kept as raw lowercase
	 *  strings rather than the player-facing CombatStyle type -- a couple of bosses (dragons)
	 *  have a "dragonfire" style with no equivalent in that type. */
	attackStyles: string[];
	immuneToPoison: boolean;
	immuneToStun: boolean;
	immuneToDeflect: boolean;
	immuneToDrain: boolean;
	/** Path under /boss-icons relative to the static root. */
	iconPath: string;
}

/** Backed by json/bosses.json, validated against bosses.schema.ts at import time. */
export const bosses: Boss[] = loadJson(bossesJson, bossesFileSchema, 'json/bosses.json');
