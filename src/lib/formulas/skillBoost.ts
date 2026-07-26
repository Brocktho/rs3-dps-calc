import type { BoostableSkill, SkillBoost } from '../data/skillBoosts';

/**
 * Applies a single boost's formula to a base level: level + floor(pct/100 * level) + flat,
 * per https://runescape.wiki/w/Temporary_skill_boost (documented there as e.g. "17% + 5" for
 * Elder overload, which -- confirmed against the user's own worked example -- means the
 * total boosted level is 1.17*level+5, i.e. the base level PLUS a 17% bonus PLUS a flat 5,
 * not the percentage term alone replacing the base level).
 */
export function applyBoost(level: number, boost: SkillBoost): number {
	return level + Math.floor((boost.pct / 100) * level) + boost.flat;
}

/**
 * The effective (boosted) level for a skill given a base level and a set of currently-active
 * boosts. Boosts don't stack -- only the single highest result among all active boosts that
 * apply to this skill counts (per the wiki: "Temporary boosts do not stack ... only the
 * higher boost counts"). Falls back to the base level when no active boost applies to this
 * skill, or the base level exceeds every applicable boost's result (e.g. a very high base
 * level with a weak boost).
 */
export function boostedLevel(
	baseLevel: number,
	skill: BoostableSkill,
	activeBoosts: SkillBoost[]
): number {
	let best = baseLevel;
	for (const boost of activeBoosts) {
		if (!boost.skills.includes(skill)) continue;
		best = Math.max(best, applyBoost(baseLevel, boost));
	}
	return best;
}
