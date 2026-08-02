import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_CONTEXT, NO_GEAR_CONTEXT } from './context';
import {
	hitChance,
	hitChanceBreakdown,
	NECROMANCY_AFFINITY,
	targetArmourRating,
	type HitChanceAdjustment
} from './hitChance';

describe('targetArmourRating', () => {
	it('matches the wiki\'s "Nex (AoD)" example: armour 2,765 + f(99) = 3,977', () => {
		expect(targetArmourRating(2765, 99)).toBe(3977);
	});

	it("matches the wiki's Kalphite King example: armour 2,178 + f(85) = 3,049", () => {
		expect(targetArmourRating(2178, 85)).toBe(3049);
	});
});

describe('hitChance', () => {
	it("matches the wiki's Saradomin godsword vs abyssal demons example (~118.7% uncapped, so caps to 100)", () => {
		// a = floor(f(99) + 2.5*f(75)) = 2,905; d = floor(1,608 + f(70)) = 2,202; Aff = 90.
		// Uncapped this would be ~118.7%, confirming the cap is what brings it down to 100.
		const uncapped = (90 * 2905) / 2202;
		expect(uncapped).toBeCloseTo(118.75, 1);
		expect(hitChance(90, 2905, 2202)).toBe(100);
	});

	it("matches the wiki's Sunspear + void knight armour example (~64.0%)", () => {
		// a ~= 3,132; d = 2,202; Aff = 45
		const result = hitChance(45, 3132, 2202);
		expect(result).toBeCloseTo(64.0, 1);
	});

	it("matches the wiki's Queen Black Dragon example (~71.5%)", () => {
		// a = 4,068; d = 2,843; Aff = 50
		const result = hitChance(50, 4068, 2843);
		expect(result).toBeCloseTo(71.57, 1);
	});

	it('caps at 100% rather than exceeding it', () => {
		expect(hitChance(90, 100000, 100)).toBe(100);
	});

	it('returns 100% when the target has no armour rating (avoids division by zero)', () => {
		expect(hitChance(90, 5000, 0)).toBe(100);
	});
});

describe('hitChanceBreakdown', () => {
	const penalty = (amountPercent: number, active = true): HitChanceAdjustment => ({
		source: { label: 'Test penalty item' },
		amountPercent,
		isActive: () => active
	});
	const breakdown = (
		adjustments: HitChanceAdjustment[],
		affinity = 90,
		accuracy = 2905,
		armour = 2202
	) =>
		hitChanceBreakdown(
			affinity,
			accuracy,
			armour,
			NO_GEAR_CONTEXT,
			DEFAULT_GLOBAL_CONTEXT,
			adjustments
		);

	it('with no adjustments, final matches the legacy hitChance() exactly', () => {
		const result = breakdown([]);
		expect(result.final).toBe(hitChance(90, 2905, 2202));
		expect(result.adjustments).toEqual([]);
		expect(result.adjusted).toBe(result.raw);
	});

	it('preserves raw UNCAPPED: 118.75% raw - 10% penalty lands at 100% final, not 90%', () => {
		// The load-bearing over-cap ordering case (design §3): the penalty applies to the raw
		// value BEFORE the cap, so an over-cap raw absorbs it.
		const result = breakdown([penalty(-10)]);
		expect(result.raw).toBeCloseTo(118.75, 1);
		expect(result.adjusted).toBeCloseTo(108.75, 1);
		expect(result.final).toBe(100);
	});

	it('a penalty big enough to drag adjusted under 100 shows up in final', () => {
		const result = breakdown([penalty(-30)]);
		expect(result.adjusted).toBeCloseTo(88.75, 1);
		expect(result.final).toBeCloseTo(88.75, 1);
	});

	it('inactive adjustments neither apply nor appear in provenance', () => {
		const result = breakdown([penalty(-30, false)]);
		expect(result.adjustments).toEqual([]);
		expect(result.final).toBe(100);
	});

	it('multiple adjustments sum additively and are each listed for provenance', () => {
		const result = breakdown([penalty(-10), penalty(5)]);
		expect(result.adjustments).toHaveLength(2);
		expect(result.adjusted).toBeCloseTo(118.75 - 10 + 5, 1);
	});

	it('clamps final at 0 when penalties exceed raw', () => {
		const result = breakdown([penalty(-80)], 45, 1000, 2202);
		expect(result.adjusted).toBeLessThan(0);
		expect(result.final).toBe(0);
	});

	it('armourRating <= 0 keeps the guaranteed-hit degenerate case (raw 100), adjustments still pre-cap', () => {
		const result = breakdown([penalty(-10)], 90, 5000, 0);
		expect(result.raw).toBe(100);
		expect(result.final).toBe(90);
	});
});

describe('NECROMANCY_AFFINITY', () => {
	it('is a fixed 60, not derived from any per-boss scraped field', () => {
		expect(NECROMANCY_AFFINITY).toBe(60);
	});
});
