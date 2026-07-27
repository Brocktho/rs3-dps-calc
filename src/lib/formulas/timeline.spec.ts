import { describe, expect, it } from 'vitest';
import { abilities } from '../data/abilities';
import { resolveAspect, type ModifierContext } from './modifiers';
import {
	abilityDamageForPlacement,
	BERSERK_BASIC_MULTIPLIER_MODIFIER,
	BERSERK_BLOODLUST_CAP_MODIFIER,
	canPlaceAbility,
	clearConflictingUses,
	colorForAbility,
	cooldownZonesFor,
	cumulativeDamage,
	damageByTick,
	earliestAvailableTick,
	effectiveCooldownTicks,
	findSwapTarget,
	gcdPlacementAt,
	hitCountFor,
	IMBUE_SHADOWS_ADRENALINE_MODIFIER,
	insertAbilityAtAnchor,
	isOffGcdAbility,
	nextOpenTick,
	packIntoLanes,
	parseBloodlustConsume,
	parseBloodlustGenerate,
	parseBuffInfo,
	parseCooldownTicks,
	parseDamageMultiplier,
	parseHitProfile,
	parsePerTickAdrenaline,
	removePlacementCloseGap,
	requiredTimelineLength,
	resolveAdrenaline,
	resolveBloodlust,
	resolveBuffs,
	resolveChannels,
	resolveDamagePercent,
	respectsCooldown,
	RING_OF_VIGOUR_MODIFIER,
	runningAverageDps,
	shiftPlacementsFrom,
	type GearContext,
	type TimelinePlacement
} from './timeline';

const dive = abilities.find((a) => a.name === 'Dive')!;
const rend = abilities.find((a) => a.name === 'Rend')!;
const fury = abilities.find((a) => a.name === 'Fury')!;
const adaptiveStrike = abilities.find((a) => a.name === 'Adaptive Strike')!;
const overpower = abilities.find((a) => a.name === 'Overpower')!; // type: 'Ultimate', adrenaline: -60
const revenge = abilities.find((a) => a.name === 'Revenge')!; // type: 'Threshold', adrenaline: -15
const assault = abilities.find((a) => a.name === 'Assault')!;
const corruptionBlast = abilities.find((a) => a.name === 'Corruption Blast')!;
const wildMagic = abilities.find((a) => a.name === 'Wild Magic')!;
const berserk = abilities.find((a) => a.name === 'Berserk')!;
const meteorStrike = abilities.find((a) => a.name === 'Meteor Strike')!;
const rangedBasic = abilities.find((a) => a.name === 'Ranged')!;
const ricochet = abilities.find((a) => a.name === 'Ricochet')!;
const imbueShadows = abilities.find((a) => a.name === 'Imbue: Shadows')!;
const hurricane = abilities.find((a) => a.name === 'Hurricane')!;

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

describe('parseCooldownTicks', () => {
	it('extracts the tick count from cooldownText', () => {
		expect(parseCooldownTicks(rend)).toBe(17);
		expect(parseCooldownTicks(overpower)).toBe(50);
	});
});

describe('effectiveCooldownTicks', () => {
	it("uses Overpower's normal 50-tick cooldown with no Berserk active", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: overpower.name, startTick: 0 }
		];
		expect(effectiveCooldownTicks(overpower, 0, placements, abilities, 100)).toBe(50);
	});

	it("uses the reduced 15-tick cooldown when Berserk is active at the cast tick", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: overpower.name, startTick: 10 },
			{ id: 'b', abilityName: berserk.name, startTick: 5 } // active roughly ticks 5-38
		];
		expect(effectiveCooldownTicks(overpower, 10, placements, abilities, 100)).toBe(15);
	});

	it('falls back to the normal cooldown for an ability with no conditional override', () => {
		expect(effectiveCooldownTicks(rend, 0, [], abilities, 100)).toBe(17);
	});
});

describe('respectsCooldown', () => {
	it('rejects a second use of the same ability inside its own cooldown window', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		expect(respectsCooldown(rend, 10, placements, abilities, 100)).toBe(false);
	});

	it('accepts a second use once the cooldown has elapsed', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		expect(respectsCooldown(rend, 17, placements, abilities, 100)).toBe(true);
	});

	it('excludes the placement being moved from its own cooldown check', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		expect(respectsCooldown(rend, 5, placements, abilities, 100, 'a')).toBe(true);
	});

	it('is unaffected by a different ability sharing the same tick range', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: fury.name, startTick: 0 }];
		expect(respectsCooldown(rend, 1, placements, abilities, 100)).toBe(true);
	});

	it('rejects reusing the ability on the exact same tick as itself', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: dive.name, startTick: 5 }];
		expect(respectsCooldown(dive, 5, placements, abilities, 100)).toBe(false);
	});
});

describe('earliestAvailableTick', () => {
	it('returns fromTick unchanged when there is no conflicting prior use', () => {
		expect(earliestAvailableTick(rend, 10, [], abilities, 100)).toBe(10);
	});

	it("pushes forward to just past a prior use's cooldown window", () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		expect(earliestAvailableTick(rend, 5, placements, abilities, 100)).toBe(17);
	});

	it('resolves chained/overlapping cooldown windows in one call', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 }, // blocks until 17
			{ id: 'b', abilityName: rend.name, startTick: 17 } // blocks until 34
		];
		expect(earliestAvailableTick(rend, 5, placements, abilities, 100)).toBe(34);
	});
});

describe('cooldownZonesFor', () => {
	it('returns one zone per existing placement of the ability', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 },
			{ id: 'b', abilityName: rend.name, startTick: 20 }
		];
		const zones = cooldownZonesFor(rend.name, placements, abilities, 100);
		expect(zones).toEqual([
			{ startTick: 0, endTick: 17 },
			{ startTick: 20, endTick: 37 }
		]);
	});

	it('excludes the given placement id (the one currently being dragged)', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		expect(cooldownZonesFor(rend.name, placements, abilities, 100, 'a')).toEqual([]);
	});
});

describe('clearConflictingUses', () => {
	it('removes a later same-name placement that is now too close after the final tick', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 },
			{ id: 'b', abilityName: rend.name, startTick: 30 }
		];
		// Moving 'a' to tick 20 puts 'b' (at 30) only 10 ticks later -- inside Rend's 17-tick cooldown.
		const result = clearConflictingUses(rend, 20, placements, abilities, 100, 'a');
		expect(result.map((p) => p.id)).toEqual(['a']);
	});

	it('removes a placement sitting exactly on the final tick', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 },
			{ id: 'b', abilityName: rend.name, startTick: 17 }
		];
		const result = clearConflictingUses(rend, 17, placements, abilities, 100, 'a');
		expect(result.map((p) => p.id)).toEqual(['a']);
	});

	it('leaves other-ability and sufficiently-spaced same-ability placements untouched', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 },
			{ id: 'b', abilityName: fury.name, startTick: 20 },
			{ id: 'c', abilityName: rend.name, startTick: 50 }
		];
		const result = clearConflictingUses(rend, 0, placements, abilities, 100, 'a');
		expect(result.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
	});
});

describe('nextOpenTick respects cooldown', () => {
	it('skips a tick that is GCD-free but still on cooldown for the same ability', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		// Rend's own GCD only blocks ticks 0-2, but its 17-tick cooldown blocks reuse until tick 17.
		expect(nextOpenTick(rend, placements, abilities, 100)).toBe(17);
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

describe('hitCountFor', () => {
	it("uses a channelled ability's own hit count (Assault: 4)", () => {
		expect(hitCountFor(assault)).toBe(4);
	});

	it('parses a bare "N hits." phrase (Adaptive Strike: 2)', () => {
		expect(hitCountFor(adaptiveStrike)).toBe(2);
	});

	it('uses the hand-curated override for Ricochet (3)', () => {
		expect(hitCountFor(ricochet)).toBe(3);
	});

	it('defaults to a single hit otherwise (Rend)', () => {
		expect(hitCountFor(rend)).toBe(1);
	});
});

describe('resolveAspect', () => {
	const ctx: ModifierContext = { combatStyle: 'ranged', ringOfVigourActive: false, furyOfTheSmallActive: false };
	const imbueWindow = [{ placementId: 'x', abilityName: 'Imbue: Shadows', startTick: 0, endTick: 10 }];

	it("Imbue: Shadows' generateBonus is 0 with no active buff window", () => {
		const result = resolveAspect([IMBUE_SHADOWS_ADRENALINE_MODIFIER], 'adrenaline', 'generateBonus', 0, [], ctx, rangedBasic);
		expect(result.additive).toBe(0);
	});

	it("adds 5% per hit for a generating Ranged ability while Imbue: Shadows' window is active (basic: +5)", () => {
		const result = resolveAspect(
			[IMBUE_SHADOWS_ADRENALINE_MODIFIER],
			'adrenaline',
			'generateBonus',
			0,
			imbueWindow,
			ctx,
			rangedBasic
		);
		expect(result.additive).toBe(5);
	});

	it('scales the bonus by hit count (Ricochet: +15 for 3 hits)', () => {
		const result = resolveAspect(
			[IMBUE_SHADOWS_ADRENALINE_MODIFIER],
			'adrenaline',
			'generateBonus',
			0,
			imbueWindow,
			ctx,
			ricochet
		);
		expect(result.additive).toBe(15);
	});

	it('does not apply the bonus to a spend (cost) ability', () => {
		const result = resolveAspect(
			[IMBUE_SHADOWS_ADRENALINE_MODIFIER],
			'adrenaline',
			'generateBonus',
			0,
			imbueWindow,
			ctx,
			overpower
		);
		expect(result.additive).toBe(0);
	});

	it('does not apply the bonus outside of Ranged', () => {
		const meleeCtx: ModifierContext = { combatStyle: 'melee', ringOfVigourActive: false, furyOfTheSmallActive: false };
		const result = resolveAspect(
			[IMBUE_SHADOWS_ADRENALINE_MODIFIER],
			'adrenaline',
			'generateBonus',
			0,
			imbueWindow,
			meleeCtx,
			rend
		);
		expect(result.additive).toBe(0);
	});

	it('Ring of Vigour costRefund is 0 when the passive is off', () => {
		const result = resolveAspect([RING_OF_VIGOUR_MODIFIER], 'adrenaline', 'costRefund', 0, [], ctx, berserk);
		expect(result.additive).toBe(0);
	});

	it('Ring of Vigour costRefund is +10 for an Ultimate spend when active', () => {
		const activeCtx: ModifierContext = { combatStyle: 'melee', ringOfVigourActive: true, furyOfTheSmallActive: false };
		const result = resolveAspect([RING_OF_VIGOUR_MODIFIER], 'adrenaline', 'costRefund', 0, [], activeCtx, berserk);
		expect(result.additive).toBe(10);
	});

	it('multiple add-operation modifiers on the same aspect stack additively', () => {
		const flatFive: typeof RING_OF_VIGOUR_MODIFIER = {
			...RING_OF_VIGOUR_MODIFIER,
			effect: { operation: 'add', value: 5 },
			appliesToAbility: undefined,
			isActive: () => true
		};
		const result = resolveAspect([RING_OF_VIGOUR_MODIFIER, flatFive], 'adrenaline', 'costRefund', 0, [], {
			combatStyle: 'melee',
			ringOfVigourActive: true
		}, berserk);
		expect(result.additive).toBe(15); // 10 (Ring of Vigour) + 5
	});

	it('multiply-operation modifiers on the same aspect combine as a product', () => {
		const berserkCtx: ModifierContext = { combatStyle: 'melee', ringOfVigourActive: false, furyOfTheSmallActive: false };
		const berserkWindow = [{ placementId: 'b', abilityName: 'Berserk', startTick: 0, endTick: 10 }];
		const doubleAgain: typeof BERSERK_BASIC_MULTIPLIER_MODIFIER = {
			...BERSERK_BASIC_MULTIPLIER_MODIFIER,
			effect: { operation: 'multiply', value: 3 }
		};
		const result = resolveAspect(
			[BERSERK_BASIC_MULTIPLIER_MODIFIER, doubleAgain],
			'bloodlust',
			'generateMultiplier',
			0,
			berserkWindow,
			berserkCtx,
			rend
		);
		expect(result.multiplier).toBe(6); // 2 * 3
	});

	it('an override-operation modifier wins for the cap aspect (Berserk: 4 -> 8)', () => {
		const berserkWindow = [{ placementId: 'b', abilityName: 'Berserk', startTick: 0, endTick: 10 }];
		const result = resolveAspect(
			[BERSERK_BLOODLUST_CAP_MODIFIER],
			'bloodlust',
			'cap',
			5,
			berserkWindow,
			{ combatStyle: 'melee', ringOfVigourActive: false, furyOfTheSmallActive: false }
		);
		expect(result.override).toBe(8);
	});

	it('a buffWindow modifier is inactive outside its own window', () => {
		const berserkWindow = [{ placementId: 'b', abilityName: 'Berserk', startTick: 0, endTick: 10 }];
		const result = resolveAspect(
			[BERSERK_BLOODLUST_CAP_MODIFIER],
			'bloodlust',
			'cap',
			15,
			berserkWindow,
			{ combatStyle: 'melee', ringOfVigourActive: false, furyOfTheSmallActive: false }
		);
		expect(result.override).toBeNull();
	});
});

describe('resolveAdrenaline', () => {
	it('starts at the configured starting value and holds steady with no placements', () => {
		const states = resolveAdrenaline([], abilities, 'melee', 40, 5);
		expect(states.every((s) => s.value === 40 && !s.insufficientForCost)).toBe(true);
	});

	it('applies both effects when two placements share the exact same tick, without drifting later ticks (regression)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 }, // +9
			{ id: 'b', abilityName: fury.name, startTick: 0 }, // +9 -> 18 total at tick 0
			{ id: 'c', abilityName: overpower.name, startTick: 5 } // -60 -> clamped to 0
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 0, 10);
		expect(states[0].value).toBe(18);
		expect(states[4].value).toBe(18); // holds steady, not drifted by the shared tick 0 write
		expect(states[5].value).toBe(0);
		expect(states[9].value).toBe(0);
	});

	it('applies a generate then a spend in tick order', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 }, // +9
			{ id: 'b', abilityName: overpower.name, startTick: 10 } // -60
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 0, 20);
		expect(states[0].value).toBe(9);
		expect(states[9].value).toBe(9);
		expect(states[10].value).toBe(0); // clamped at 0, not negative
	});

	it('flags insufficientForCost without blocking the spend', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: overpower.name, startTick: 0 }
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 10, 5);
		expect(states[0].insufficientForCost).toBe(true);
		expect(states[0].value).toBe(0);
	});

	it('clamps generation at 100', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
		const states = resolveAdrenaline(placements, abilities, 'melee', 95, 3);
		expect(states[0].value).toBe(100);
	});

	it("applies Imbue: Shadows' bonus when its buff window covers the placement tick", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: imbueShadows.name, startTick: 0 },
			{ id: 'b', abilityName: rangedBasic.name, startTick: 5 }
		];
		const states = resolveAdrenaline(placements, abilities, 'ranged', 0, 10);
		// imbueShadows itself costs 40 (clamped at 0), then rangedBasic gains 14 (9 + 5*1).
		expect(states[5].value).toBe(14);
	});

	it('does not refund adrenaline for an Ultimate when Ring of Vigour is off', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: berserk.name, startTick: 0 }];
		const states = resolveAdrenaline(placements, abilities, 'melee', 100, 5);
		expect(states[0].value).toBe(0);
	});

	it('refunds a flat 10% after a 100%-cost Ultimate when Ring of Vigour is active (Berserk: 100 -> 10)', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: berserk.name, startTick: 0 }];
		const states = resolveAdrenaline(placements, abilities, 'melee', 100, 5, true);
		expect(states[0].value).toBe(10);
	});

	it('refunds a flat 10% after a 60%-cost Ultimate, with no passive income yet on that same activation tick (Meteor Strike: 100 -> 50)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: meteorStrike.name, startTick: 0 }
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 100, 5, true);
		expect(states[0].value).toBe(50);
	});

	it('does not refund for non-Ultimate spends even when Ring of Vigour is active (Revenge is Threshold)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: revenge.name, startTick: 0 }
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 100, 5, true);
		expect(states[0].value).toBe(85); // 100 - 15, no refund since Revenge is Threshold not Ultimate
	});

	it('refunds Overpower too, since it is actually an Ultimate ability despite its Threshold-like 15-tick cooldown quirk', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: overpower.name, startTick: 0 }
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 100, 5, true);
		expect(states[0].value).toBe(50); // 100 - 60 + 10 refund
	});

	it('clamps the refund at 100; a later Meteor Strike cast still has no passive income on its own activation tick', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 }, // +9 -> 100 (clamped)
			{ id: 'b', abilityName: meteorStrike.name, startTick: 3 } // 100 - 60 + 10 = 50
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 95, 10, true);
		expect(states[0].value).toBe(100);
		expect(states[3].value).toBe(50);
	});

	/**
	 * Order-of-operations regression, confirmed against a real in-game sequence: within a single
	 * tick, a placement's own cost/refund resolves BEFORE that same tick's ambient passive income
	 * (when that income is already flowing from an earlier activation) -- not the other way around.
	 * Casting Berserk (100% cost) on a tick where Meteor Strike's income is already active, with Ring
	 * of Vigour equipped, lands at 100 -> 0 (cost) -> 10 (refund) -> 14.5 (that tick's Meteor Strike
	 * income) -- never just 10.
	 */
	it("applies a same-tick spend and refund before that tick's ambient passive income (Berserk under an active Meteor Strike buff, with Ring of Vigour: -> 0 -> 10 -> 14.5)", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'meteor', abilityName: meteorStrike.name, startTick: 0 },
			{ id: 'berserk', abilityName: berserk.name, startTick: 3 }
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 100, 6, true);
		expect(states[0].value).toBe(50); // Meteor Strike's own cast: no income yet this tick
		expect(states[2].value).toBe(59); // 50 + 4.5 (tick1) + 4.5 (tick2)
		expect(states[3].value).toBe(14.5);
	});

	/**
	 * perTickIncome specifically does not start until the tick AFTER a buff's own activation tick --
	 * confirmed directly: Meteor Strike's own cast costs 60 with no passive income yet that same
	 * tick, and the first +4.5 lands the following tick.
	 */
	it("applies Meteor Strike's 4.5%/tick passive income starting the tick AFTER its own activation tick", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: meteorStrike.name, startTick: 0 }
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 0, 4);
		expect(states[0].value).toBe(0); // -60 clamped to 0, no income yet on the activation tick
		expect(states[1].value).toBe(4.5);
		expect(states[2].value).toBe(9);
		expect(states[3].value).toBe(13.5);
	});

	/**
	 * Meteor Strike's own text: "Melee basic abilities generate 1.5x Adrenaline" while its buff is
	 * active. Unlike perTickIncome, this multiplier is active starting on Meteor Strike's own
	 * activation tick. Confirmed end-to-end against a real sequence: Meteor Strike cast with Ring of
	 * Vigour active (100 -> 50), then Adaptive Strike on the next GCD (tick 3) lands at 81.5% --
	 * 59 (50 + two ticks of +4.5 ambient income) + 18 (Adaptive Strike's 12% boosted 1.5x) + 4.5
	 * (that same tick's own ambient income) = 81.5.
	 */
	it('boosts melee Basic adrenaline generation by 1.5x while Meteor Strike is active (Adaptive Strike lands at 81.5% on the next GCD)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'meteor', abilityName: meteorStrike.name, startTick: 0 },
			{ id: 'adaptive', abilityName: adaptiveStrike.name, startTick: 3 }
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 100, 5, true);
		expect(states[3].value).toBe(81.5);
	});

	it('does not boost a Basic used before Meteor Strike is cast', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'adaptive', abilityName: adaptiveStrike.name, startTick: 0 } // plain 12, no multiplier
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 0, 3);
		expect(states[0].value).toBe(12);
	});

	/**
	 * Fury of the Small: +1 flat adrenaline on every generating ability, stacking additively with
	 * other generateBonus/generateMultiplier effects via the existing (base + bonus) * multiplier
	 * order -- confirmed directly: Adaptive Strike (12) -> 13 normally, or 13 * 1.5 = 19.5 during
	 * Meteor Strike's buff.
	 */
	it('adds a flat +1 adrenaline to a generating ability when Fury of the Small is active', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'adaptive', abilityName: adaptiveStrike.name, startTick: 0 }
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 0, 3, false, true);
		expect(states[0].value).toBe(13);
	});

	it('does not add a flat +1 to a spend (Fury of the Small only affects generation)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'overpower', abilityName: overpower.name, startTick: 0 }
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 100, 3, false, true);
		expect(states[0].value).toBe(40); // -60, no change from Fury of the Small
	});

	it('stacks additively with Meteor Strike\'s 1.5x melee Basic multiplier (Adaptive Strike: 13 * 1.5 = 19.5)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'meteor', abilityName: meteorStrike.name, startTick: 0 },
			{ id: 'adaptive', abilityName: adaptiveStrike.name, startTick: 3 }
		];
		// Ring of Vigour off here to isolate Fury of the Small's interaction with Meteor Strike:
		// 0 -> -60 clamped to 0 -> +4.5 (tick1) -> +4.5 (tick2) = 9 by tick3, then (12 + 1) * 1.5 =
		// 19.5 -> 28.5, then that tick's own +4.5 ambient income -> 33.
		const states = resolveAdrenaline(placements, abilities, 'melee', 60, 6, false, true);
		expect(states[3].value).toBe(33);
	});

});

describe('parsePerTickAdrenaline', () => {
	it("parses Meteor Strike's flat per-tick adrenaline income", () => {
		expect(parsePerTickAdrenaline(meteorStrike)).toEqual({ amountPerTick: 4.5, intervalTicks: 1 });
	});

	it('returns null for abilities with no such clause', () => {
		expect(parsePerTickAdrenaline(rend)).toBeNull();
		expect(parsePerTickAdrenaline(berserk)).toBeNull();
	});
});

describe('parseBloodlustGenerate / parseBloodlustConsume', () => {
	it('parses Bloodlust generation amounts', () => {
		expect(parseBloodlustGenerate(rend)).toBe(2);
		expect(parseBloodlustGenerate(fury)).toBe(1);
		expect(parseBloodlustGenerate(berserk)).toBe(4);
	});

	it('returns 0 generation for an ability that only consumes', () => {
		expect(parseBloodlustGenerate(hurricane)).toBe(0);
	});

	it('parses the Bloodlust consumption trigger amount', () => {
		expect(parseBloodlustConsume(hurricane)).toBe(4);
	});

	it('returns 0 consumption for an ability with no such trigger', () => {
		expect(parseBloodlustConsume(rend)).toBe(0);
	});
});

describe('resolveBloodlust', () => {
	it('applies both effects when two placements share the exact same tick, without drifting later ticks (regression)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 }, // +2
			{ id: 'b', abilityName: fury.name, startTick: 0 }, // +1 -> 3 total at tick 0
			{ id: 'c', abilityName: rend.name, startTick: 5 } // +2 -> would be 5, clamped to 4
		];
		const states = resolveBloodlust(placements, abilities, 8);
		expect(states[0].value).toBe(3);
		expect(states[4].value).toBe(3); // holds steady, not drifted by the shared tick 0 write
		expect(states[5].value).toBe(4);
	});

	it('accumulates generation from melee Basic abilities', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 }, // +2
			{ id: 'b', abilityName: fury.name, startTick: 3 } // +1
		];
		const states = resolveBloodlust(placements, abilities, 6);
		expect(states[0].value).toBe(2);
		expect(states[3].value).toBe(3);
	});

	it('caps generation at 4 outside of Berserk', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 }, // +2 -> 2
			{ id: 'b', abilityName: rend.name, startTick: 3 }, // +2 -> 4
			{ id: 'c', abilityName: rend.name, startTick: 6 } // +2 -> would be 6, clamped to 4
		];
		const states = resolveBloodlust(placements, abilities, 9);
		expect(states[6].value).toBe(4);
		expect(states[6].cap).toBe(4);
	});

	it('raises the cap to 8 and doubles Basic generation while Berserk is active', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'berserk', abilityName: berserk.name, startTick: 0 }, // grants 4 stacks itself
			{ id: 'a', abilityName: rend.name, startTick: 3 } // +2*2=4 while Berserk active
		];
		const states = resolveBloodlust(placements, abilities, 6);
		expect(states[0].value).toBe(4);
		expect(states[3].value).toBe(8);
		expect(states[3].cap).toBe(8);
	});

	it('consumes stacks only when enough are banked', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: hurricane.name, startTick: 0 } // consumes 4, but 0 banked
		];
		const states = resolveBloodlust(placements, abilities, 3);
		expect(states[0].value).toBe(0);
	});

	it('ignores non-melee placements (value holds steady)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rangedBasic.name, startTick: 0 }
		];
		const states = resolveBloodlust(placements, abilities, 3);
		expect(states.map((s) => s.value)).toEqual([0, 0, 0]);
	});
});
