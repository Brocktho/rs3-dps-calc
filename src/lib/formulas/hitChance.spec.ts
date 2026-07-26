import { describe, expect, it } from 'vitest';
import { hitChance, NECROMANCY_AFFINITY, targetArmourRating } from './hitChance';

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

describe('NECROMANCY_AFFINITY', () => {
	it('is a fixed 60, not derived from any per-boss scraped field', () => {
		expect(NECROMANCY_AFFINITY).toBe(60);
	});
});
