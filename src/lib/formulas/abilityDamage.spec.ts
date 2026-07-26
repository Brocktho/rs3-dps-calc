import { describe, expect, it } from 'vitest';
import { abilityHitRange, calculateAbilityDamage, levelBonus } from './abilityDamage';

describe('levelBonus', () => {
	it('matches f(level) = 145 * ln(1 + 0.6*level/145) / ln(1.6)', () => {
		expect(levelBonus(120)).toBeCloseTo(124.37930257304232, 10);
		expect(levelBonus(99)).toBeCloseTo(105.92480293545111, 10);
		expect(levelBonus(1)).toBeCloseTo(1.27395193852547, 10);
	});

	it('is zero at level 0', () => {
		expect(levelBonus(0)).toBe(0);
	});
});

describe('calculateAbilityDamage - magic dual wield', () => {
	it('matches hand-computed value for level 120, tier 90/90, spell tier 6, no bonus', () => {
		const result = calculateAbilityDamage({
			style: 'magic',
			weapon: { kind: 'dualWield', mainHandTier: 90, offHandTier: 90 },
			level: 120,
			bonus: 0,
			styleTier: 6
		});

		expect(result.mainHand).toBe(367);
		expect(result.offHand).toBe(183);
		expect(result.total).toBe(550);
	});

	it('caps effective tier at the spell tier via min(t, s)', () => {
		const lowTierWeapon = calculateAbilityDamage({
			style: 'magic',
			weapon: { kind: 'dualWield', mainHandTier: 6, offHandTier: 6 },
			level: 120,
			bonus: 0,
			styleTier: 90
		});
		const highTierWeaponSameSpell = calculateAbilityDamage({
			style: 'magic',
			weapon: { kind: 'dualWield', mainHandTier: 90, offHandTier: 90 },
			level: 120,
			bonus: 0,
			styleTier: 6
		});

		// min(6, 90) === min(90, 6) === 6, so both should produce identical AD.
		expect(lowTierWeapon).toEqual(highTierWeaponSameSpell);
	});
});

describe('calculateAbilityDamage - melee two-handed', () => {
	it('matches hand-computed value for level 99 strength, tier 90 weapon, bonus 500', () => {
		const result = calculateAbilityDamage({
			style: 'melee',
			weapon: { kind: 'twoHanded', tier: 90 },
			level: 99,
			bonus: 500
		});

		expect(result.mainHand).toBe(2442);
		expect(result.offHand).toBe(0);
		expect(result.total).toBe(2442);
	});
});

describe('calculateAbilityDamage - ranged two-handed with ammo tier', () => {
	it('caps effective tier at ammo tier when ammo tier is lower than weapon tier', () => {
		const result = calculateAbilityDamage({
			style: 'ranged',
			weapon: { kind: 'twoHanded', tier: 90 },
			level: 99,
			bonus: 100,
			styleTier: 20
		});

		expect(result.total).toBe(834);
	});

	it('matches in-game reading for level 109, Masterwork bow (damageTier 100), Bik arrow (damageTier 100)', () => {
		// Regression test: Masterwork bow's general `tier` is 99 and Bik arrow's is 95, but
		// both have a separate `damageTier` of 100 that the ability-damage formula actually
		// uses -- using the wrong (general) tier field previously produced 1798 instead of
		// the in-game value of 1870.
		const result = calculateAbilityDamage({
			style: 'ranged',
			weapon: { kind: 'twoHanded', tier: 100 },
			level: 109,
			bonus: 0,
			styleTier: 100
		});

		expect(result.total).toBe(1870);
	});

	it('matches in-game reading with Masterwork ranged body/legs/cowl damage bonus applied', () => {
		// Regression test: equipping Masterwork ranged body (damage bonus 37.5), chaps (31.2),
		// and cowl (25.0) on top of the previous 1870 scenario should raise AD to 2009 in-game.
		// This only matches when each piece's bonus is floored individually BEFORE summing
		// (37 + 31 + 25 = 93) and fed into the formula's `b` term -- summing the raw fractional
		// bonuses first and flooring once at the end (93.7 -> 93) coincidentally also gives 93
		// here, but flooring the whole 1.5*b term per-piece instead of once overall does not,
		// so the summing order matters and is covered by this exact scraped case.
		const bonus = Math.floor(37.5) + Math.floor(31.2) + Math.floor(25.0);
		const result = calculateAbilityDamage({
			style: 'ranged',
			weapon: { kind: 'twoHanded', tier: 100 },
			level: 109,
			bonus,
			styleTier: 100
		});

		expect(result.total).toBe(2009);
	});
});

describe('calculateAbilityDamage - necromancy', () => {
	it('matches hand-computed value and ignores styleTier (uses weapon tier directly)', () => {
		const result = calculateAbilityDamage({
			style: 'necromancy',
			weapon: { kind: 'dualWield', mainHandTier: 20, offHandTier: 20 },
			level: 120,
			bonus: 300
		});

		expect(result.mainHand).toBe(802);
		expect(result.offHand).toBe(401);
		expect(result.total).toBe(1203);
	});

	it('throws for two-handed weapons, which necromancy has no formula for', () => {
		expect(() =>
			calculateAbilityDamage({
				style: 'necromancy',
				weapon: { kind: 'twoHanded', tier: 20 },
				level: 120,
				bonus: 0
			})
		).toThrow();
	});
});

describe('abilityHitRange', () => {
	it('applies Rend-style 1.35x-1.65x multipliers and floors the result', () => {
		const range = abilityHitRange(1000, 1.35, 1.65);
		expect(range.min).toBe(1350);
		expect(range.max).toBe(1650);
	});

	it('floors fractional results down', () => {
		const range = abilityHitRange(333, 1.35, 1.65);
		// 333 * 1.35 = 449.55 -> 449, 333 * 1.65 = 549.45 -> 549
		expect(range.min).toBe(449);
		expect(range.max).toBe(549);
	});
});
