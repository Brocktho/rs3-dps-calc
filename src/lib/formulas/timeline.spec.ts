import { describe, expect, it } from 'vitest';
import { abilities } from '../data/abilities';
import {
	abilityDamageForPlacement,
	canPlaceAbility,
	colorForAbility,
	cumulativeDamage,
	damageByTick,
	findSwapTarget,
	gcdPlacementAt,
	insertAbilityAtAnchor,
	isOffGcdAbility,
	nextOpenTick,
	packIntoLanes,
	parseBuffInfo,
	parseDamageMultiplier,
	parseHitProfile,
	removePlacementCloseGap,
	requiredTimelineLength,
	resolveBuffs,
	resolveChannels,
	resolveDamagePercent,
	runningAverageDps,
	shiftPlacementsFrom,
	type GearContext,
	type TimelinePlacement
} from './timeline';

const dive = abilities.find((a) => a.name === 'Dive')!;
const rend = abilities.find((a) => a.name === 'Rend')!;
const fury = abilities.find((a) => a.name === 'Fury')!;
const adaptiveStrike = abilities.find((a) => a.name === 'Adaptive Strike')!;
const overpower = abilities.find((a) => a.name === 'Overpower')!;
const assault = abilities.find((a) => a.name === 'Assault')!;
const corruptionBlast = abilities.find((a) => a.name === 'Corruption Blast')!;
const wildMagic = abilities.find((a) => a.name === 'Wild Magic')!;
const berserk = abilities.find((a) => a.name === 'Berserk')!;
const meteorStrike = abilities.find((a) => a.name === 'Meteor Strike')!;

const NEUTRAL_GEAR: GearContext = {
	isTwoHanded: false,
	hasOffHandWeapon: false,
	equippedCapeName: null
};

describe('isOffGcdAbility', () => {
	it('flags Dive as usable during the GCD', () => {
		expect(isOffGcdAbility(dive)).toBe(true);
	});

	it('does not flag a normal basic ability', () => {
		expect(isOffGcdAbility(rend)).toBe(false);
	});
});

describe('parseDamageMultiplier', () => {
	it('parses a flat percent', () => {
		expect(parseDamageMultiplier('150%')).toBeCloseTo(1.5);
	});

	it('parses a range as its midpoint', () => {
		expect(parseDamageMultiplier('90%-110%')).toBeCloseTo(1.0);
	});

	it('returns null for N/A', () => {
		expect(parseDamageMultiplier('N/A')).toBeNull();
	});

	it('returns null for null input', () => {
		expect(parseDamageMultiplier(null)).toBeNull();
	});
});

describe('resolveDamagePercent', () => {
	it('returns the flat damagePercent when there are no variants', () => {
		expect(resolveDamagePercent(rend, NEUTRAL_GEAR)).toBe('150%');
	});

	it('picks the two-handed variant when wielding a two-handed weapon', () => {
		const gear: GearContext = { ...NEUTRAL_GEAR, isTwoHanded: true };
		expect(resolveDamagePercent(adaptiveStrike, gear)).toBe('130%');
	});

	it('picks the dual-wield variant when wielding an off-hand weapon', () => {
		const gear: GearContext = { ...NEUTRAL_GEAR, hasOffHandWeapon: true };
		expect(resolveDamagePercent(adaptiveStrike, gear)).toBe('135%');
	});

	it('picks the main-hand-only variant with no off-hand and no two-hander', () => {
		expect(resolveDamagePercent(adaptiveStrike, NEUTRAL_GEAR)).toBe('130%');
	});

	it('falls back to the "Any" value with no matching gear condition', () => {
		expect(resolveDamagePercent(overpower, NEUTRAL_GEAR)).toBe('545%');
	});
});

describe('abilityDamageForPlacement', () => {
	it('multiplies AD total by the parsed damage percent, floored', () => {
		// Rend: 150% of 1000 AD -> 1500
		expect(abilityDamageForPlacement(rend, 1000, NEUTRAL_GEAR)).toBe(1500);
	});

	it('returns 0 for a non-damaging ability', () => {
		expect(abilityDamageForPlacement(dive, 1000, NEUTRAL_GEAR)).toBe(0);
	});
});

describe('canPlaceAbility / nextOpenTick', () => {
	it('allows placing a GCD ability at tick 0 on an empty timeline', () => {
		expect(canPlaceAbility(rend, 0, [], abilities, 100)).toBe(true);
	});

	it('rejects a GCD ability overlapping another GCD ability', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		// Rend spans ticks 0-2; Fury at tick 1 or 2 should collide.
		expect(canPlaceAbility(fury, 1, placements, abilities, 100)).toBe(false);
		expect(canPlaceAbility(fury, 3, placements, abilities, 100)).toBe(true);
	});

	it('allows an off-GCD ability to stack on top of a GCD ability at the same tick', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		expect(canPlaceAbility(dive, 1, placements, abilities, 100)).toBe(true);
	});

	it('allows two off-GCD abilities to stack on the same tick', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: dive.name, startTick: 5 }];
		expect(canPlaceAbility(dive, 5, placements, abilities, 100)).toBe(true);
	});

	it('rejects placement that runs past the end of the timeline', () => {
		expect(canPlaceAbility(rend, 98, [], abilities, 100)).toBe(false);
	});

	it('excludes the placement being moved from its own collision check', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		expect(canPlaceAbility(rend, 1, placements, abilities, 100, 'a')).toBe(true);
	});

	it('nextOpenTick finds the first free slot after an existing GCD placement', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		expect(nextOpenTick(fury, placements, abilities, 100)).toBe(3);
	});
});

describe('damageByTick / cumulativeDamage / runningAverageDps', () => {
	it('sums placement damage into its start tick and computes cumulative/average lines', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 }, // 150% of 1000 -> 1500
			{ id: 'b', abilityName: fury.name, startTick: 3 } // 120% of 1000 -> 1200
		];
		const byTick = damageByTick(placements, abilities, 1000, NEUTRAL_GEAR, 6);
		expect(byTick).toEqual([1500, 0, 0, 1200, 0, 0]);

		const cumulative = cumulativeDamage(byTick);
		expect(cumulative).toEqual([1500, 1500, 1500, 2700, 2700, 2700]);

		const avgDps = runningAverageDps(byTick);
		expect(avgDps[0]).toBeCloseTo(1500 / 0.6);
		expect(avgDps[5]).toBeCloseTo(2700 / (6 * 0.6));
	});
});

describe('parseHitProfile', () => {
	it('parses "Attack N times over Xs (Y ticks)" into hits/interval (Assault: 4 hits/7 ticks -> interval 2)', () => {
		expect(parseHitProfile(assault)).toEqual({ kind: 'channel', hits: 4, intervalTicks: 2 });
	});

	it('parses "per hit every Xs (Y ticks) ... N hits" into hits/interval (Corruption Blast)', () => {
		expect(parseHitProfile(corruptionBlast)).toEqual({
			kind: 'channel',
			hits: 5,
			intervalTicks: 2
		});
	});

	it('treats a bare "N hits" with no spread timing as single (Adaptive Strike, Wild Magic)', () => {
		expect(parseHitProfile(adaptiveStrike)).toEqual({ kind: 'single' });
		expect(parseHitProfile(wildMagic)).toEqual({ kind: 'single' });
	});

	it('treats an ability with no hit-count language as single (Rend)', () => {
		expect(parseHitProfile(rend)).toEqual({ kind: 'single' });
	});
});

describe('parseBuffInfo', () => {
	it("parses Berserk's self-buff duration (19.8s / 33 ticks)", () => {
		expect(parseBuffInfo(berserk)).toEqual({ durationTicks: 33 });
	});

	it('returns null for an ability with no self-buff duration', () => {
		expect(parseBuffInfo(rend)).toBeNull();
	});
});

describe('resolveChannels', () => {
	it("computes Assault's natural hit ticks (0, 2, 4, 6) with no interruption", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: assault.name, startTick: 0 }
		];
		const [resolved] = resolveChannels(placements, abilities, 100);
		expect(resolved.hitTicks).toEqual([0, 2, 4, 6]);
		expect(resolved.barEndTick).toBe(7);
	});

	it('truncates surviving hits when a later GCD ability interrupts the channel (matches the user\'s own example: only 2 of 4 Assault hits land)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: assault.name, startTick: 0 },
			{ id: 'b', abilityName: rend.name, startTick: 3 }
		];
		const [resolved] = resolveChannels(placements, abilities, 100);
		expect(resolved.hitTicks).toEqual([0, 2]);
		expect(resolved.barEndTick).toBe(3);
	});

	it('is not interrupted by an off-GCD placement', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: assault.name, startTick: 0 },
			{ id: 'b', abilityName: dive.name, startTick: 3 }
		];
		const [resolved] = resolveChannels(placements, abilities, 100);
		expect(resolved.hitTicks).toEqual([0, 2, 4, 6]);
	});
});

describe('resolveBuffs', () => {
	it("resolves Berserk's active window from its placement", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: berserk.name, startTick: 10 }
		];
		const [resolved] = resolveBuffs(placements, abilities, 100);
		expect(resolved.startTick).toBe(10);
		expect(resolved.endTick).toBe(43);
	});

	it('clips the end tick to the timeline length', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: berserk.name, startTick: 10 }
		];
		const [resolved] = resolveBuffs(placements, abilities, 20);
		expect(resolved.endTick).toBe(20);
	});
});

describe('packIntoLanes', () => {
	it('gives overlapping items separate lanes and reuses a freed lane for a later non-overlapping item', () => {
		const items = [
			{ startTick: 0, endTick: 10 },
			{ startTick: 5, endTick: 15 },
			{ startTick: 12, endTick: 20 }
		];
		const packed = packIntoLanes(items);
		expect(packed.find((i) => i.startTick === 0)?.lane).toBe(0);
		expect(packed.find((i) => i.startTick === 5)?.lane).toBe(1);
		// Starts at 12, after lane 0's item ended at 10 -> reuses lane 0.
		expect(packed.find((i) => i.startTick === 12)?.lane).toBe(0);
	});
});

describe('colorForAbility', () => {
	it('is deterministic for the same ability name', () => {
		expect(colorForAbility('Berserk')).toBe(colorForAbility('Berserk'));
	});

	it('returns an hsl() color string', () => {
		expect(colorForAbility('Berserk')).toMatch(/^hsl\(\d+, 65%, 55%\)$/);
	});
});

describe('findSwapTarget', () => {
	it('finds the other placement when dragging one GCD ability directly onto another', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 },
			{ id: 'b', abilityName: fury.name, startTick: 3 }
		];
		const target = findSwapTarget('a', 3, placements, abilities, 100);
		expect(target?.id).toBe('b');
	});

	it('returns null when the drop target tick has no conflicting placement', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		expect(findSwapTarget('a', 10, placements, abilities, 100)).toBeNull();
	});

	it('returns null when the target span overlaps more than one other placement', () => {
		// This state (two placements already overlapping each other) can't arise through normal
		// GCD collision rules, but the guard against an ambiguous multi-conflict swap should hold
		// regardless of how the state was reached.
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 10 },
			{ id: 'b', abilityName: fury.name, startTick: 0 },
			{ id: 'c', abilityName: fury.name, startTick: 3 }
		];
		// Moving 'a' (span 3) to tick 2 would cover ticks 2-4, overlapping both b (0-2) and c (3-5).
		expect(findSwapTarget('a', 2, placements, abilities, 100)).toBeNull();
	});

	it('returns null for an off-GCD ability (it never collides, so never needs to swap)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: dive.name, startTick: 0 },
			{ id: 'b', abilityName: dive.name, startTick: 5 }
		];
		expect(findSwapTarget('a', 5, placements, abilities, 100)).toBeNull();
	});

	it('identifies the same sole conflict whether the drop lands exactly on the target or only partially overlaps it (regression: Meteor Strike at 0-2, Berserk at 3-5, dragging Berserk to start at tick 2)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'meteor', abilityName: meteorStrike.name, startTick: 0 },
			{ id: 'berserk', abilityName: berserk.name, startTick: 3 }
		];
		// Dropped exactly on Meteor Strike's start.
		expect(findSwapTarget('berserk', 0, placements, abilities, 100)?.id).toBe('meteor');
		// Dropped one tick off (only partially overlapping Meteor Strike's span 0-2) -- the
		// caller must still resolve this to a full exchange of ORIGINAL ticks (0 and 3), never
		// to the raw dropped tick (2), which would leave Meteor Strike at 3-5 and Berserk at
		// 2-4 -- two GCD placements overlapping at ticks 3-4.
		expect(findSwapTarget('berserk', 2, placements, abilities, 100)?.id).toBe('meteor');
	});
});

describe('gcdPlacementAt', () => {
	it('finds the placement whose span covers the given tick', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 3 }];
		expect(gcdPlacementAt(3, placements, abilities)?.id).toBe('a');
		expect(gcdPlacementAt(5, placements, abilities)?.id).toBe('a');
		expect(gcdPlacementAt(2, placements, abilities)).toBeNull();
		expect(gcdPlacementAt(6, placements, abilities)).toBeNull();
	});

	it('ignores off-GCD placements', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: dive.name, startTick: 3 }];
		expect(gcdPlacementAt(3, placements, abilities)).toBeNull();
	});
});

describe('shiftPlacementsFrom / removePlacementCloseGap', () => {
	it('shifts everything at or after the pivot tick later, leaving earlier placements untouched', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 },
			{ id: 'b', abilityName: dive.name, startTick: 4 },
			{ id: 'c', abilityName: fury.name, startTick: 3 }
		];
		const shifted = shiftPlacementsFrom(placements, 3, 3);
		expect(shifted.find((p) => p.id === 'a')?.startTick).toBe(0);
		expect(shifted.find((p) => p.id === 'b')?.startTick).toBe(7);
		expect(shifted.find((p) => p.id === 'c')?.startTick).toBe(6);
	});

	it('removes a placement and closes the gap by shifting everything after it earlier by its own span', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 },
			{ id: 'b', abilityName: fury.name, startTick: 3 },
			{ id: 'c', abilityName: fury.name, startTick: 6 }
		];
		const closed = removePlacementCloseGap(placements, abilities, 'a');
		expect(closed.find((p) => p.id === 'a')).toBeUndefined();
		expect(closed.find((p) => p.id === 'b')?.startTick).toBe(0);
		expect(closed.find((p) => p.id === 'c')?.startTick).toBe(3);
	});

	it('leaves placements before the removed one untouched', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 },
			{ id: 'b', abilityName: fury.name, startTick: 3 }
		];
		const closed = removePlacementCloseGap(placements, abilities, 'b');
		expect(closed.find((p) => p.id === 'a')?.startTick).toBe(0);
	});
});

describe('insertAbilityAtAnchor', () => {
	it("inserting before an anchor shifts the anchor and everything after it later (user's example: Meteor Strike before Berserk)", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'berserk', abilityName: berserk.name, startTick: 0 },
			{ id: 'adaptive', abilityName: adaptiveStrike.name, startTick: 3 },
			{ id: 'overpower', abilityName: overpower.name, startTick: 6 }
		];
		const result = insertAbilityAtAnchor(
			placements,
			abilities,
			meteorStrike,
			'berserk',
			'before',
			'meteor'
		)!;
		expect(result.find((p) => p.id === 'meteor')?.startTick).toBe(0);
		expect(result.find((p) => p.id === 'berserk')?.startTick).toBe(3);
		expect(result.find((p) => p.id === 'adaptive')?.startTick).toBe(6);
		expect(result.find((p) => p.id === 'overpower')?.startTick).toBe(9);
	});

	it("inserting after an anchor leaves the anchor itself in place (user's example: Meteor Strike after Berserk)", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'berserk', abilityName: berserk.name, startTick: 0 },
			{ id: 'adaptive', abilityName: adaptiveStrike.name, startTick: 3 },
			{ id: 'overpower', abilityName: overpower.name, startTick: 6 }
		];
		const result = insertAbilityAtAnchor(
			placements,
			abilities,
			meteorStrike,
			'berserk',
			'after',
			'meteor'
		)!;
		expect(result.find((p) => p.id === 'berserk')?.startTick).toBe(0);
		expect(result.find((p) => p.id === 'meteor')?.startTick).toBe(3);
		expect(result.find((p) => p.id === 'adaptive')?.startTick).toBe(6);
		expect(result.find((p) => p.id === 'overpower')?.startTick).toBe(9);
	});

	it('shifts an off-GCD placement caught in the shifted range along with everything else', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'berserk', abilityName: berserk.name, startTick: 0 },
			{ id: 'dive', abilityName: dive.name, startTick: 1 }
		];
		const result = insertAbilityAtAnchor(
			placements,
			abilities,
			meteorStrike,
			'berserk',
			'before',
			'meteor'
		)!;
		expect(result.find((p) => p.id === 'dive')?.startTick).toBe(4);
	});

	it('reorders an existing placement by id, closing its old gap before inserting it at the new spot', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 },
			{ id: 'b', abilityName: fury.name, startTick: 3 },
			{ id: 'c', abilityName: fury.name, startTick: 6 },
			{ id: 'd', abilityName: fury.name, startTick: 9 }
		];
		// Drag D to insert before B -- matches the general reorder example discussed.
		const result = insertAbilityAtAnchor(placements, abilities, fury, 'b', 'before', 'd')!;
		expect(result.find((p) => p.id === 'a')?.startTick).toBe(0);
		expect(result.find((p) => p.id === 'd')?.startTick).toBe(3);
		expect(result.find((p) => p.id === 'b')?.startTick).toBe(6);
		expect(result.find((p) => p.id === 'c')?.startTick).toBe(9);
	});

	it('returns null when the anchor does not exist', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 }
		];
		expect(
			insertAbilityAtAnchor(placements, abilities, meteorStrike, 'missing', 'before', 'new')
		).toBeNull();
	});

	it('returns null when the anchor is an off-GCD placement', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: dive.name, startTick: 0 }];
		expect(
			insertAbilityAtAnchor(placements, abilities, meteorStrike, 'a', 'before', 'new')
		).toBeNull();
	});

	it('returns null when asked to insert a placement relative to itself', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		expect(insertAbilityAtAnchor(placements, abilities, rend, 'a', 'before', 'a')).toBeNull();
	});
});

describe('requiredTimelineLength', () => {
	it('accounts for a plain GCD ability span', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 10 }];
		expect(requiredTimelineLength(placements, abilities)).toBe(13);
	});

	it("accounts for a buff's full duration, even past its GCD span", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: berserk.name, startTick: 10 }
		];
		// Berserk: GCD span ends at 13, but its 33-tick buff duration reaches 43.
		expect(requiredTimelineLength(placements, abilities)).toBe(43);
	});

	it("accounts for a channel's natural hit window, even past its GCD span", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: assault.name, startTick: 10 }
		];
		// Assault: GCD span ends at 13, but hits land through tick 16 (10 + 3*2), window end 17.
		expect(requiredTimelineLength(placements, abilities)).toBe(17);
	});
});

describe('damageByTick with a channelled ability', () => {
	it("divides Corruption Blast's total damage evenly across its 5 hit ticks", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: corruptionBlast.name, startTick: 0 }
		];
		// Corruption Blast: damagePercent '300%' -> 3000 of 1000 AD, / 5 hits = 600 per hit,
		// landing at ticks 0, 2, 4, 6, 8.
		const byTick = damageByTick(placements, abilities, 1000, NEUTRAL_GEAR, 12);
		expect(byTick[0]).toBe(600);
		expect(byTick[2]).toBe(600);
		expect(byTick[4]).toBe(600);
		expect(byTick[6]).toBe(600);
		expect(byTick[8]).toBe(600);
		expect(cumulativeDamage(byTick)[11]).toBe(3000);
	});

	it('reduces the total proportionally when the channel is interrupted', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: corruptionBlast.name, startTick: 0 },
			{ id: 'b', abilityName: rend.name, startTick: 3 }
		];
		const byTick = damageByTick(placements, abilities, 1000, NEUTRAL_GEAR, 12);
		// Only the tick-0 hit survives (tick 2 would also survive since 2 < 3... both land).
		expect(byTick[0]).toBe(600);
		expect(byTick[2]).toBe(600);
		expect(byTick[4]).toBe(0);
		expect(byTick[6]).toBe(0);
		expect(byTick[8]).toBe(0);
	});
});
