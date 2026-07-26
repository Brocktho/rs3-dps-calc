import { describe, expect, it } from 'vitest';
import { accuracySkillBonus, hybridNerf } from './accuracy';

describe('accuracySkillBonus', () => {
	it('matches in-game reading for Ranged level 109 (Masterwork bow: 3100 weapon + 1512 skill bonus = 4612)', () => {
		expect(Math.floor(accuracySkillBonus(109))).toBe(1512);
	});
});

describe('hybridNerf', () => {
	it('matches in-game reading for Malevolent cuirass alone against a ranged weapon (-400)', () => {
		// Melee is weak against Ranged's counter (Ranged beats Melee's counter, Magic), so
		// melee armour is the "B" (0.8x) bucket when wielding a ranged weapon, not the "A"
		// (1.5x) bucket -- confirmed because 0.8*500.9 floors to exactly 400.
		const result = hybridNerf('ranged', [{ armourClass: 'melee', armour: 500.9 }]);
		expect(result).toBe(-400);
	});

	it('matches in-game reading for Malevolent cuirass + greaves against a ranged weapon (-783)', () => {
		// Regression test: floor(0.8*500.9) + floor(0.8*479.1) = 400 + 383 = 783 matches the
		// in-game reading, while flooring the summed armour first (floor(0.8*980) = 784) does
		// not -- each piece must be floored individually before summing, same convention as
		// the ability damage bonus term.
		const result = hybridNerf('ranged', [
			{ armourClass: 'melee', armour: 500.9 },
			{ armourClass: 'melee', armour: 479.1 }
		]);
		expect(result).toBe(-783);
	});

	it('applies the 1.5x coefficient to the armour class weak against the weapon (magic vs ranged)', () => {
		const result = hybridNerf('ranged', [{ armourClass: 'magic', armour: 100 }]);
		expect(result).toBe(-150);
	});

	it('ignores armour matching the weapon style', () => {
		const result = hybridNerf('ranged', [{ armourClass: 'ranged', armour: 1000 }]);
		expect(result).toBe(0);
	});

	it('treats necromancy armour as always the 0.8x bucket, never the weakness bucket', () => {
		const result = hybridNerf('magic', [{ armourClass: 'necromancy', armour: 100 }]);
		expect(result).toBe(-80);
	});

	it('exempts armour with no combat-triangle class (hybrid jewelry, igneous Kal-Zuk)', () => {
		const result = hybridNerf('ranged', [{ armourClass: null, armour: 1000 }]);
		expect(result).toBe(0);
	});

	it('returns 0 with no armour equipped', () => {
		expect(hybridNerf('melee', [])).toBe(0);
	});
});
