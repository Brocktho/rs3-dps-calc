import { describe, expect, it } from 'vitest';
import { skillBoosts } from '../data/skillBoosts';
import { applyBoost, boostedLevel } from './skillBoost';

function findBoost(name: string) {
	const boost = skillBoosts.find((b) => b.name === name);
	if (!boost) throw new Error(`missing boost fixture: ${name}`);
	return boost;
}

describe('applyBoost', () => {
	it('matches Elder overload: floor(1.17 * level) + 5', () => {
		const elderOverload = findBoost('Elder overload potion');
		expect(applyBoost(99, elderOverload)).toBe(Math.floor(1.17 * 99) + 5);
		expect(applyBoost(99, elderOverload)).toBe(120);
	});

	it('matches Overload: floor(1.15 * level) + 3', () => {
		const overload = findBoost('Overload');
		expect(applyBoost(99, overload)).toBe(Math.floor(1.15 * 99) + 3);
	});

	it('matches Supreme overload potion: floor(1.16 * level) + 4', () => {
		const supremeOverload = findBoost('Supreme overload potion');
		expect(applyBoost(99, supremeOverload)).toBe(Math.floor(1.16 * 99) + 4);
	});

	it('matches Super attack: floor(1.12 * level) + 2', () => {
		const superAttack = findBoost('Super attack');
		expect(applyBoost(99, superAttack)).toBe(Math.floor(1.12 * 99) + 2);
	});

	it('matches Extreme attack: floor(1.15 * level) + 3', () => {
		const extremeAttack = findBoost('Extreme attack');
		expect(applyBoost(99, extremeAttack)).toBe(Math.floor(1.15 * 99) + 3);
	});
});

describe('boostedLevel', () => {
	it('returns the base level when no boosts are active', () => {
		expect(boostedLevel(99, 'ranged', [])).toBe(99);
	});

	it('returns the base level when no active boost applies to this skill', () => {
		const superAttack = findBoost('Super attack');
		expect(boostedLevel(99, 'ranged', [superAttack])).toBe(99);
	});

	it('picks the higher of two applicable boosts (Extreme ranging over Super ranging)', () => {
		const superRanging = findBoost('Super ranging potion');
		const extremeRanging = findBoost('Extreme ranging');
		const result = boostedLevel(99, 'ranged', [superRanging, extremeRanging]);
		expect(result).toBe(applyBoost(99, extremeRanging));
		expect(result).toBeGreaterThan(applyBoost(99, superRanging));
	});

	it('picks Elder overload over both Super and Extreme ranging when all three are active', () => {
		const superRanging = findBoost('Super ranging potion');
		const extremeRanging = findBoost('Extreme ranging');
		const elderOverload = findBoost('Elder overload potion');
		const result = boostedLevel(99, 'ranged', [superRanging, extremeRanging, elderOverload]);
		expect(result).toBe(applyBoost(99, elderOverload));
	});
});
