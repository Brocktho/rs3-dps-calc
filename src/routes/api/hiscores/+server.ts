import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Row order of https://secure.runescape.com/m=hiscore/index_lite.ws?player=X's CSV response
 * (each row is `rank,level,xp`) -- undocumented but stable, confirmed against
 * runescape.wiki/w/HiScores's own "Minimum levels" skill table and cross-checked against a
 * real maxed account's response (Defence capping at 99 while Attack/Necromancy showed 120
 * matched this exact ordering). Only the combat-relevant skills used by this calculator are
 * named; the rest of the 29 rows are skipped.
 */
const HISCORE_ROW_SKILL = [
	'overall',
	'attack',
	'defence',
	'strength',
	'constitution',
	'ranged',
	'prayer',
	'magic'
] as const;
// Necromancy is the 30th and last row of the response (index 29), far past the other combat
// skills which are all packed into the first 8 rows above.
const NECROMANCY_ROW_INDEX = 29;

export interface HiscoreLevels {
	attack: number;
	defence: number;
	strength: number;
	ranged: number;
	magic: number;
	necromancy: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

// In-memory, per-server-instance cache so repeated lookups for the same player (whether from
// one user re-checking, or multiple users) don't re-hit the upstream HiScores endpoint every
// time -- it's a shared resource, not something to hammer per page load. Keyed on the
// lowercased name since RSNs are case-insensitive in-game. Resets on server restart/redeploy,
// which is fine for a 5-minute TTL.
const cache = new Map<string, { levels: HiscoreLevels; expiresAt: number }>();

function getCached(key: string): HiscoreLevels | null {
	const entry = cache.get(key);
	if (!entry) return null;
	if (Date.now() >= entry.expiresAt) {
		cache.delete(key);
		return null;
	}
	return entry.levels;
}

export const GET: RequestHandler = async ({ url, fetch }) => {
	const player = url.searchParams.get('player')?.trim();
	if (!player) {
		error(400, 'Missing player name');
	}

	const cacheKey = player.toLowerCase();
	const cached = getCached(cacheKey);
	if (cached) {
		return json(cached);
	}

	const upstream = await fetch(
		`https://secure.runescape.com/m=hiscore/index_lite.ws?player=${encodeURIComponent(player)}`
	);

	if (upstream.status === 404) {
		error(404, `Player "${player}" not found on the HiScores`);
	}
	if (!upstream.ok) {
		error(502, `HiScores lookup failed (${upstream.status})`);
	}

	const text = await upstream.text();
	const rows = text
		.trim()
		.split('\n')
		.map((row) => row.split(',').map(Number));

	// Skills below the HiScores ranking threshold report `-1,-1` (no real level exposed by
	// this endpoint at all) -- fall back to 1 rather than a negative number.
	const levelAt = (index: number): number => {
		const row = rows[index];
		if (!row || row.length < 2 || row[1] < 0) return 1;
		return row[1];
	};

	const levels: Partial<HiscoreLevels> = {};
	for (const [index, skill] of HISCORE_ROW_SKILL.entries()) {
		if (skill === 'overall' || skill === 'constitution' || skill === 'prayer') continue;
		levels[skill as keyof HiscoreLevels] = levelAt(index);
	}
	levels.necromancy = levelAt(NECROMANCY_ROW_INDEX);

	const result = levels as HiscoreLevels;
	cache.set(cacheKey, { levels: result, expiresAt: Date.now() + CACHE_TTL_MS });

	return json(result);
};
