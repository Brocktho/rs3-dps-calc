import { describe, expect, it } from 'vitest';
import { baseArmourRating } from './armourRating';

describe('baseArmourRating', () => {
	it('matches f(x) = floor(x^3/1250 + 4x + 40)', () => {
		// Independently verified against runescape.wiki/w/Hit_chance's boss armour rating
		// table, which lists f(defence) for several worked examples.
		expect(baseArmourRating(60)).toBe(452);
		expect(baseArmourRating(99)).toBe(1212);
	});

	it('is 40 at level 0', () => {
		expect(baseArmourRating(0)).toBe(40);
	});

	it('rounds down fractional results', () => {
		// f(70) = 594.4 -> floors to 594
		expect(baseArmourRating(70)).toBe(594);
	});
});
