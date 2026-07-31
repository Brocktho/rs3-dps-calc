import { describe, expect, it } from 'vitest';
import { abilities } from '../data/abilities';
import { resolveAspect, type ModifierContext } from './modifiers';
import {
	abilityDamageForPlacement,
	applyVestmentsBerserkExtension,
	BERSERK_BASIC_MULTIPLIER_MODIFIER,
	BERSERK_BLOODLUST_CAP_MODIFIER,
	BERSERK_MELEE_DAMAGE_MULTIPLIER,
	buffBaseEndTick,
	canPlaceAbility,
	CHAOS_ROAR_DAMAGE_MULTIPLIER,
	CHAOS_ROAR_DURATION_TICKS,
	clearConflictingUses,
	colorForAbility,
	cooldownZonesFor,
	cumulativeDamage,
	damageByTick,
	earliestAvailableTick,
	effectiveCooldownTicks,
	findSwapTarget,
	gcdPlacementAt,
	GREATER_BARGE_BLEED_WINDOW_TICKS,
	GREATER_BARGE_OUT_OF_COMBAT_TICKS,
	GREATER_FURY_CRIT_MULTIPLIER,
	GREATER_FURY_DURATION_TICKS,
	groupBuffExtensions,
	HAVOC_INSTANT_BURST_PERCENT,
	HAVOC_REGEN_PERCENT,
	hitCountFor,
	IMBUE_SHADOWS_ADRENALINE_MODIFIER,
	insertAbilityAtAnchor,
	isMeleeUltimate,
	isOffGcdAbility,
	MAX_DAMAGE_PER_HIT,
	nextOpenTick,
	packIntoLanes,
	parseBloodlustConsume,
	parseBloodlustGenerate,
	parseBuffExtension,
	parseBuffInfo,
	parseCooldownTicks,
	parseDamageMultiplier,
	parseHitProfile,
	parsePerTickAdrenaline,
	removePlacementCloseGap,
	requiredTimelineLength,
	resolveAdrenaline,
	resolveAllBuffs,
	resolveBloodlust,
	resolveBuffs,
	resolveChannels,
	resolveDamagePercent,
	resolveChaosRoarBuffs,
	resolveEndlessAssaultBleeds,
	resolveGreaterFuryBuffs,
	resolveHavocBuffs,
	resolveHitCountVariant,
	respectsCooldown,
	RING_OF_VIGOUR_MODIFIER,
	MIN_DPM_WINDOW_SECONDS,
	runningAverageDps,
	SEARING_WINDS_BONUS_PERCENT,
	shiftPlacementsFrom,
	slidingWindowDpm,
	VESTMENTS_OF_HAVOC_4PC_ADRENALINE_CAP,
	VESTMENTS_OF_HAVOC_SET_NAME,
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
const deadshot = abilities.find((a) => a.name === 'Deadshot')!; // type: 'Ultimate', adrenaline: -60
const rapidFire = abilities.find((a) => a.name === 'Rapid Fire')!; // channelled, 8 hits, adrenaline: -25
const greaterDeathsSwiftness = abilities.find((a) => a.name === "Greater Death's Swiftness")!; // target: 'Self'
const hurricane = abilities.find((a) => a.name === 'Hurricane')!;
const galeshot = abilities.find((a) => a.name === 'Galeshot')!; // applies "Searing Winds" self-buff, 10 ticks
const shadowTendrils = abilities.find((a) => a.name === 'Shadow Tendrils')!; // extends Shadow imbued +6 ticks
const greaterFlurry = abilities.find((a) => a.name === 'Greater Flurry')!; // channelled, 8 hits, extends Berserk +1/hit
const greaterFury = abilities.find((a) => a.name === 'Greater Fury')!; // 25-tick guaranteed-crit-on-next-hit buff
const chaosRoar = abilities.find((a) => a.name === 'Chaos Roar')!; // 12-tick 1.75x-next-strike buff
const greaterBarge = abilities.find((a) => a.name === 'Greater Barge')!; // grants Endless Assault if 8+ ticks since last damage
const surge = abilities.find((a) => a.name === 'Surge')!; // target: 'Self', off-gcd, non-damaging
const dismember = abilities.find((a) => a.name === 'Dismember')!; // unconditional bleed, 8 hits/2 ticks
const omnipower = abilities.find((a) => a.name === 'Omnipower')!; // type: 'Ultimate', igneous Kal-Mej/Kal-Zuk hit-count variant
const deathSkulls = abilities.find((a) => a.name === 'Death Skulls')!; // type: 'Ultimate', igneous Kal-Mor/Kal-Zuk hit-count variant
const slaughter = abilities.find((a) => a.name === 'Slaughter')!; // unconditional bleed, 6 hits/3 ticks
const massacre = abilities.find((a) => a.name === 'Massacre')!; // unconditional bleed, 7 hits/4 ticks

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

describe('slidingWindowDpm', () => {
	it('divides by elapsed time (not the full window) before the window has filled, so early ticks read as the true rate over what has actually happened', () => {
		// windowSeconds=6, tickSeconds=1 -> windowTicks=6, full window = 6s. Using a window well
		// past MIN_DPM_WINDOW_SECONDS (1.8s) so the elapsed-time clamp (not the GCD floor) is what's
		// under test here -- see the dedicated floor test below for ticks inside one GCD.
		const byTick = [100, 100, 100, 100, 100, 100, 100];
		const dpm = slidingWindowDpm(byTick, 6, 1);
		// Only 2s has elapsed at tick 1 (past the 1.8s GCD floor) -- divide by that 2s, not the
		// full 6s window, so the rate isn't diluted by ticks that are simply in the future.
		expect(dpm[1]).toBeCloseTo((200 / 2) * 60);
		expect(dpm[2]).toBeCloseTo((300 / 3) * 60);
		// Once the window is genuinely full, it's a true trailing sum over exactly windowTicks.
		expect(dpm[5]).toBeCloseTo((600 / 6) * 60);
		expect(dpm[6]).toBeCloseTo((600 / 6) * 60);
	});

	it('drops damage that falls out of the trailing window', () => {
		const byTick = [600, 0, 0, 0, 0, 0, 0];
		const dpm = slidingWindowDpm(byTick, 6, 1);
		expect(dpm[5]).toBeCloseTo((600 / 6) * 60);
		// Tick 6: the window is [1..6], which no longer includes tick 0's burst.
		expect(dpm[6]).toBeCloseTo(0);
	});

	it('floors the divisor at one GCD (1.8s/3 ticks), so a single early hit reads as one flat rate instead of spiking then decaying', () => {
		// Real tick length (0.6s) and a window bigger than one GCD, matching how the chart actually
		// calls this in practice.
		const byTick = [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0];
		const dpm = slidingWindowDpm(byTick);
		// Ticks 0, 1, 2 all fall within one GCD (0.6s, 1.2s, 1.8s elapsed) -- nothing else could
		// possibly have landed yet, so all three should read the identical rate over 1.8s, not an
		// inflated-then-decaying curve keyed off however little time has technically elapsed.
		const expected = (1000 / MIN_DPM_WINDOW_SECONDS) * 60;
		expect(dpm[0]).toBeCloseTo(expected);
		expect(dpm[1]).toBeCloseTo(expected);
		expect(dpm[2]).toBeCloseTo(expected);
		// Tick 3 (2.4s elapsed) is past the floor, so it's back to dividing by real elapsed time.
		expect(dpm[3]).toBeCloseTo((1000 / 2.4) * 60);
	});
});

describe('parseHitProfile', () => {
	it('parses "Attack N times over Xs (Y ticks)" into hits/interval (Assault: 4 hits/7 ticks -> interval 2)', () => {
		expect(parseHitProfile(assault)).toEqual({
			kind: 'channel',
			hits: 4,
			intervalTicks: 2,
			isBleed: false
		});
	});

	it('parses "per hit every Xs (Y ticks) ... N hits" into hits/interval (Corruption Blast)', () => {
		expect(parseHitProfile(corruptionBlast)).toEqual({
			kind: 'channel',
			hits: 5,
			intervalTicks: 2,
			isBleed: false
		});
	});

	it('treats a bare "N hits" with no spread timing as single (Adaptive Strike, Wild Magic)', () => {
		expect(parseHitProfile(adaptiveStrike)).toEqual({ kind: 'single' });
		expect(parseHitProfile(wildMagic)).toEqual({ kind: 'single' });
	});

	it('treats an ability with no hit-count language as single (Rend)', () => {
		expect(parseHitProfile(rend)).toEqual({ kind: 'single' });
	});

	it('flags Dismember, Slaughter, and Massacre as unconditional bleeds (BLEED_ABILITY_NAMES)', () => {
		expect(parseHitProfile(dismember)).toMatchObject({ kind: 'channel', isBleed: true });
		expect(parseHitProfile(slaughter)).toMatchObject({ kind: 'channel', isBleed: true });
		expect(parseHitProfile(massacre)).toMatchObject({ kind: 'channel', isBleed: true });
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
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: assault.name, startTick: 0 }];
		const [resolved] = resolveChannels(placements, abilities, 100);
		expect(resolved.hitTicks).toEqual([0, 2, 4, 6]);
		expect(resolved.barEndTick).toBe(7);
	});

	it("truncates surviving hits when a later GCD ability interrupts the channel (matches the user's own example: only 2 of 4 Assault hits land)", () => {
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

	it('Dismember (an unconditional bleed) is never interrupted by a later placement', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: dismember.name, startTick: 0 },
			{ id: 'b', abilityName: rend.name, startTick: 3 }
		];
		const [resolved] = resolveChannels(placements, abilities, 100);
		// All 8 natural hits (interval 2) land regardless of Rend at tick 3.
		expect(resolved.hitTicks).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
		expect(resolved.barEndTick).toBe(15);
		expect(resolved.isBleed).toBe(true);
	});

	it('Slaughter and Massacre are likewise never interrupted', () => {
		const placements: TimelinePlacement[] = [
			{ id: 's', abilityName: slaughter.name, startTick: 0 },
			{ id: 'm', abilityName: massacre.name, startTick: 3 },
			{ id: 'interrupter', abilityName: rend.name, startTick: 6 }
		];
		const channels = resolveChannels(placements, abilities, 100);
		const slaughterChannel = channels.find((c) => c.placementId === 's')!;
		const massacreChannel = channels.find((c) => c.placementId === 'm')!;
		expect(slaughterChannel.hitTicks).toEqual([0, 3, 6, 9, 12, 15]);
		expect(slaughterChannel.isBleed).toBe(true);
		expect(massacreChannel.hitTicks).toEqual([3, 7, 11, 15, 19, 23, 27]);
		expect(massacreChannel.isBleed).toBe(true);
	});
});

describe('parseBuffExtension', () => {
	it("parses Shadow Tendrils' single extension of Shadow imbued (+6 ticks)", () => {
		expect(parseBuffExtension(shadowTendrils)).toEqual({
			buffDisplayName: 'Shadow imbued',
			extendTicks: 6
		});
	});

	it("parses Rapid Fire's per-attack extension of Searing Winds (+1 tick)", () => {
		expect(parseBuffExtension(rapidFire)).toEqual({
			buffDisplayName: 'Searing Winds',
			extendTicks: 1
		});
	});

	it("parses Greater Flurry's per-attack extension of Berserk (+1 tick)", () => {
		expect(parseBuffExtension(greaterFlurry)).toEqual({
			buffDisplayName: 'Berserk',
			extendTicks: 1
		});
	});

	it('returns null for an ability with no extension clause', () => {
		expect(parseBuffExtension(rend)).toBeNull();
	});
});

describe('resolveBuffs', () => {
	it("resolves Berserk's active window from its placement", () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: berserk.name, startTick: 10 }];
		const [resolved] = resolveBuffs(placements, abilities, 100);
		expect(resolved.startTick).toBe(10);
		expect(resolved.endTick).toBe(43);
	});

	it('clips the end tick to the timeline length', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: berserk.name, startTick: 10 }];
		const [resolved] = resolveBuffs(placements, abilities, 20);
		expect(resolved.endTick).toBe(20);
	});

	it("Shadow Tendrils extends Imbue: Shadows' buff window by 6 ticks on a single cast", () => {
		// Imbue: Shadows: 50-tick buff (30s), starts tick 0 -> ends tick 50.
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: imbueShadows.name, startTick: 0 },
			{ id: 'b', abilityName: shadowTendrils.name, startTick: 5 }
		];
		const [buff] = resolveBuffs(placements, abilities, 100);
		expect(buff.abilityName).toBe('Imbue: Shadows');
		expect(buff.endTick).toBe(56);
		expect(buff.extensions).toEqual([
			{ tick: 5, extendTicks: 6, sourceAbilityName: 'Shadow Tendrils' }
		]);
	});

	it('does not extend a buff that already expired before the extending cast', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: imbueShadows.name, startTick: 0 },
			{ id: 'b', abilityName: shadowTendrils.name, startTick: 60 } // long after Imbue's 50-tick window
		];
		const [buff] = resolveBuffs(placements, abilities, 100);
		expect(buff.endTick).toBe(50);
	});

	it("Rapid Fire extends Galeshot's Searing Winds buff by 1 tick per hit (8 hits -> +8 total)", () => {
		// Galeshot: 10-tick buff, starts tick 0 -> ends tick 10.
		// Rapid Fire (8 hits, interval 1) cast at tick 2 hits at 2,3,4,5,6,7,8,9 -- every hit
		// lands before the buff's (extending) end tick, so all 8 extensions apply.
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: galeshot.name, startTick: 0 },
			{ id: 'b', abilityName: rapidFire.name, startTick: 2 }
		];
		const [buff] = resolveBuffs(placements, abilities, 100);
		expect(buff.abilityName).toBe('Galeshot');
		expect(buff.endTick).toBe(18);
		expect(buff.extensions).toHaveLength(8);
		expect(buff.extensions.map((e) => e.tick)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
		expect(buff.extensions.every((e) => e.sourceAbilityName === 'Rapid Fire')).toBe(true);
		expect(buff.extensions.every((e) => e.extendTicks === 1)).toBe(true);
	});

	it('only extends hits that land while the buff (as extended so far) is still active', () => {
		// Galeshot: 10-tick buff, starts tick 0 -> ends tick 10. Rapid Fire cast late, at tick 8,
		// hits at 8,9,10,11,12,13,14,15. Only the tick-8 and tick-9 hits land before the buff's
		// still-10 end tick; each extends it by 1, so after the tick-8 hit endTick becomes 11,
		// which the tick-9 hit still beats (9 < 11) extending it again to 12. The tick-10 hit
		// arrives exactly at the (now 12) end tick, which is still < 12, so it also lands... this
		// keeps going until a hit tick is not < the current end tick.
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: galeshot.name, startTick: 0 },
			{ id: 'b', abilityName: rapidFire.name, startTick: 8 }
		];
		const [buff] = resolveBuffs(placements, abilities, 100);
		// Hits at 8,9,10,11,12,13,14,15 vs a running end tick starting at 10:
		// 8<10 -> end=11; 9<11 -> end=12; 10<12 -> end=13; 11<13 -> end=14; 12<14 -> end=15;
		// 13<15 -> end=16; 14<16 -> end=17; 15<17 -> end=18. All 8 hits land.
		expect(buff.endTick).toBe(18);
	});
});

describe('buffBaseEndTick', () => {
	it("returns the buff's own endTick unchanged when it was never extended", () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: berserk.name, startTick: 0 }];
		const [buff] = resolveBuffs(placements, abilities, 100);
		expect(buffBaseEndTick(buff)).toBe(buff.endTick);
	});

	it('backs out every applied extension to recover the pre-extension endTick', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: galeshot.name, startTick: 0 },
			{ id: 'b', abilityName: rapidFire.name, startTick: 2 }
		];
		const [buff] = resolveBuffs(placements, abilities, 100);
		// Galeshot's own buff duration is 10 ticks, unaffected by however Rapid Fire extended it.
		expect(buffBaseEndTick(buff)).toBe(10);
	});
});

describe('groupBuffExtensions', () => {
	it('returns an empty array for a buff with no extensions', () => {
		expect(groupBuffExtensions([], 10)).toEqual([]);
	});

	it("collapses Rapid Fire's 8 individual +1-tick hits into a single group", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: galeshot.name, startTick: 0 },
			{ id: 'b', abilityName: rapidFire.name, startTick: 2 }
		];
		const [buff] = resolveBuffs(placements, abilities, 100);
		const groups = groupBuffExtensions(buff.extensions, buffBaseEndTick(buff));
		// Galeshot's own 10-tick buff would naturally end at tick 10 -- the highlighted region
		// covers only the 8 ticks actually added by Rapid Fire's hits (10 -> 18), not the whole
		// span back to when Rapid Fire was first cast.
		expect(groups).toEqual([
			{
				sourceAbilityName: 'Rapid Fire',
				startTick: 10,
				endTick: 18,
				totalExtendTicks: 8,
				eventCount: 8
			}
		]);
	});

	it('keeps a single one-off extension as its own group of size 1', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: imbueShadows.name, startTick: 0 },
			{ id: 'b', abilityName: shadowTendrils.name, startTick: 5 }
		];
		const [buff] = resolveBuffs(placements, abilities, 100);
		const groups = groupBuffExtensions(buff.extensions, buffBaseEndTick(buff));
		// Imbue: Shadows' own 50-tick buff would naturally end at tick 50 -- the highlighted
		// region covers only the 6 added ticks (50 -> 56), not the whole span back to when
		// Shadow Tendrils was cast (tick 5).
		expect(groups).toEqual([
			{
				sourceAbilityName: 'Shadow Tendrils',
				startTick: 50,
				endTick: 56,
				totalExtendTicks: 6,
				eventCount: 1
			}
		]);
	});

	it('starts a new group when the extending source ability changes', () => {
		const groups = groupBuffExtensions(
			[
				{ tick: 2, extendTicks: 1, sourceAbilityName: 'Rapid Fire' },
				{ tick: 3, extendTicks: 1, sourceAbilityName: 'Rapid Fire' },
				{ tick: 20, extendTicks: 6, sourceAbilityName: 'Shadow Tendrils' }
			],
			10
		);
		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({ sourceAbilityName: 'Rapid Fire', eventCount: 2 });
		expect(groups[1]).toMatchObject({ sourceAbilityName: 'Shadow Tendrils', eventCount: 1 });
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

	it('uses the reduced 15-tick cooldown when Berserk is active at the cast tick', () => {
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

	it("skips past a channelled ability's FULL natural duration, not just its 3-tick GCD block (Rapid Fire: 8 hits over 8 ticks)", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rapidFire.name, startTick: 0 }
		];
		// Rapid Fire's own GCD block is only ticks 0-2 (any other ability's canPlaceAbility check
		// would allow tick 3), but its channel's last hit lands at tick 7, so the natural window
		// runs through tick 7 -- click-to-place should land Rend at tick 8, not 3, so Rapid Fire
		// gets to finish uninterrupted.
		expect(nextOpenTick(rend, placements, abilities, 100)).toBe(8);
	});

	it('does not apply channel-skipping to a non-channelled existing placement (only its own 3-tick GCD block matters)', () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: fury.name, startTick: 0 }];
		expect(nextOpenTick(rend, placements, abilities, 100)).toBe(3);
	});

	it('does not wait for a bleed-converted channel to finish -- only its 3-tick GCD block matters', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rapidFire.name, startTick: 0 }
		];
		// Without the bleed exemption this would be 8 (Rapid Fire's full 8-tick channel), same as
		// the plain-channel case above -- tagging it as a bleed (Greater Barge's Endless Assault)
		// means later placements no longer truncate it, so there's nothing left to wait for.
		expect(nextOpenTick(rend, placements, abilities, 100, new Set(['a']))).toBe(3);
	});

	it('does not wait for an unconditional bleed (Dismember) to finish -- only its 3-tick GCD block matters', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: dismember.name, startTick: 0 }
		];
		// Dismember's natural hit window runs through tick 14 (8 hits, interval 2), but being an
		// unconditional bleed (BLEED_ABILITY_NAMES) means it's never interrupted regardless of what
		// comes after -- so click-to-place has nothing to protect by waiting, same as any ordinary
		// (non-channelled) ability.
		expect(nextOpenTick(rend, placements, abilities, 100)).toBe(3);
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
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: rend.name, startTick: 0 }];
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
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: berserk.name, startTick: 10 }];
		// Berserk: GCD span ends at 13, but its 33-tick buff duration reaches 43.
		expect(requiredTimelineLength(placements, abilities)).toBe(43);
	});

	it("accounts for a channel's natural hit window, even past its GCD span", () => {
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: assault.name, startTick: 10 }];
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

	it('uses hitCountVariants for a gear-dependent hit count (Adaptive Strike: 1 main-hand-only/two-handed, 2 dual wield)', () => {
		expect(hitCountFor(adaptiveStrike, NEUTRAL_GEAR)).toBe(1); // main hand, no offhand
		expect(hitCountFor(adaptiveStrike, { ...NEUTRAL_GEAR, isTwoHanded: true })).toBe(1);
		expect(hitCountFor(adaptiveStrike, { ...NEUTRAL_GEAR, hasOffHandWeapon: true })).toBe(2); // dual wield
	});

	it('uses the hand-curated override for Ricochet (3)', () => {
		expect(hitCountFor(ricochet)).toBe(3);
	});

	it('defaults to a single hit otherwise (Rend)', () => {
		expect(hitCountFor(rend)).toBe(1);
	});
});

describe('resolveAspect', () => {
	const ctx: ModifierContext = {
		combatStyle: 'ranged',
		ringOfVigourActive: false,
		furyOfTheSmallActive: false,
		setPieceCounts: {},
		hasMeleeWeaponEquipped: false
	};
	const imbueWindow = [
		{ placementId: 'x', abilityName: 'Imbue: Shadows', startTick: 0, endTick: 10, extensions: [] }
	];

	it("Imbue: Shadows' generateBonus is 0 with no active buff window", () => {
		const result = resolveAspect(
			[IMBUE_SHADOWS_ADRENALINE_MODIFIER],
			'adrenaline',
			'generateBonus',
			0,
			[],
			ctx,
			rangedBasic
		);
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

	it("applies a flat 5 per call regardless of the ability's own hit count (Ricochet) -- hit-count scaling is resolveResource's job via one call per hit tick, not resolveAspect's", () => {
		const result = resolveAspect(
			[IMBUE_SHADOWS_ADRENALINE_MODIFIER],
			'adrenaline',
			'generateBonus',
			0,
			imbueWindow,
			ctx,
			ricochet
		);
		expect(result.additive).toBe(5);
	});

	it('applies the bonus to a Ranged Ultimate that still lands a hit (Deadshot), not just generating abilities', () => {
		// Regression test: Imbue: Shadows previously gated on `ability.adrenaline > 0`, which
		// wrongly excluded every Enhanced/Ultimate Ranged attack (their adrenaline field is
		// negative, since they cost rather than generate) -- confirmed against the wiki, which
		// has no such restriction ("Ranged attacks against your target generate 5% Adrenaline
		// with each hit"), and directly by the user via a rotation that relies on Rapid Fire,
		// Shadow Tendrils, and Deadshot all gaining Imbue: Shadows adrenaline, and by the user's
		// report that Deadshot's Ring of Vigour interaction wasn't reflecting this bonus at all.
		// See the `resolveAdrenaline` describe block below for the full 8-hits-worth-40 scenario.
		const result = resolveAspect(
			[IMBUE_SHADOWS_ADRENALINE_MODIFIER],
			'adrenaline',
			'generateBonus',
			0,
			imbueWindow,
			ctx,
			deadshot
		);
		expect(result.additive).toBe(5);
	});

	it("does not apply the bonus to a self-targeted buff (Greater Death's Swiftness), since it never hits the target", () => {
		const result = resolveAspect(
			[IMBUE_SHADOWS_ADRENALINE_MODIFIER],
			'adrenaline',
			'generateBonus',
			0,
			imbueWindow,
			ctx,
			greaterDeathsSwiftness
		);
		expect(result.additive).toBe(0);
	});

	it('does not apply the bonus to melee abilities regardless of hit/target shape (Overpower)', () => {
		const meleeCtx: ModifierContext = {
			combatStyle: 'melee',
			ringOfVigourActive: false,
			furyOfTheSmallActive: false,
			setPieceCounts: {},
			hasMeleeWeaponEquipped: false
		};
		const result = resolveAspect(
			[IMBUE_SHADOWS_ADRENALINE_MODIFIER],
			'adrenaline',
			'generateBonus',
			0,
			imbueWindow,
			meleeCtx,
			overpower
		);
		expect(result.additive).toBe(0);
	});

	it('does not apply the bonus outside of Ranged', () => {
		const meleeCtx: ModifierContext = {
			combatStyle: 'melee',
			ringOfVigourActive: false,
			furyOfTheSmallActive: false,
			setPieceCounts: {},
			hasMeleeWeaponEquipped: false
		};
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
		const result = resolveAspect(
			[RING_OF_VIGOUR_MODIFIER],
			'adrenaline',
			'costRefund',
			0,
			[],
			ctx,
			berserk
		);
		expect(result.additive).toBe(0);
	});

	it('Ring of Vigour costRefund is +10 for an Ultimate spend when active', () => {
		const activeCtx: ModifierContext = {
			combatStyle: 'melee',
			ringOfVigourActive: true,
			furyOfTheSmallActive: false,
			setPieceCounts: {},
			hasMeleeWeaponEquipped: false
		};
		const result = resolveAspect(
			[RING_OF_VIGOUR_MODIFIER],
			'adrenaline',
			'costRefund',
			0,
			[],
			activeCtx,
			berserk
		);
		expect(result.additive).toBe(10);
	});

	it('multiple add-operation modifiers on the same aspect stack additively', () => {
		const flatFive: typeof RING_OF_VIGOUR_MODIFIER = {
			...RING_OF_VIGOUR_MODIFIER,
			effect: { operation: 'add', value: 5 },
			appliesToAbility: undefined,
			isActive: () => true
		};
		const result = resolveAspect(
			[RING_OF_VIGOUR_MODIFIER, flatFive],
			'adrenaline',
			'costRefund',
			0,
			[],
			{
				combatStyle: 'melee',
				ringOfVigourActive: true,
				furyOfTheSmallActive: false,
				setPieceCounts: {},
				hasMeleeWeaponEquipped: false
			},
			berserk
		);
		expect(result.additive).toBe(15); // 10 (Ring of Vigour) + 5
	});

	it('multiply-operation modifiers on the same aspect combine as a product', () => {
		const berserkCtx: ModifierContext = {
			combatStyle: 'melee',
			ringOfVigourActive: false,
			furyOfTheSmallActive: false,
			setPieceCounts: {},
			hasMeleeWeaponEquipped: false
		};
		const berserkWindow = [
			{ placementId: 'b', abilityName: 'Berserk', startTick: 0, endTick: 10, extensions: [] }
		];
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
		const berserkWindow = [
			{ placementId: 'b', abilityName: 'Berserk', startTick: 0, endTick: 10, extensions: [] }
		];
		const result = resolveAspect(
			[BERSERK_BLOODLUST_CAP_MODIFIER],
			'bloodlust',
			'cap',
			5,
			berserkWindow,
			{
				combatStyle: 'melee',
				ringOfVigourActive: false,
				furyOfTheSmallActive: false,
				setPieceCounts: {},
				hasMeleeWeaponEquipped: false
			}
		);
		expect(result.override).toBe(8);
	});

	it('a buffWindow modifier is inactive outside its own window', () => {
		const berserkWindow = [
			{ placementId: 'b', abilityName: 'Berserk', startTick: 0, endTick: 10, extensions: [] }
		];
		const result = resolveAspect(
			[BERSERK_BLOODLUST_CAP_MODIFIER],
			'bloodlust',
			'cap',
			15,
			berserkWindow,
			{
				combatStyle: 'melee',
				ringOfVigourActive: false,
				furyOfTheSmallActive: false,
				setPieceCounts: {},
				hasMeleeWeaponEquipped: false
			}
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

	it("credits Imbue: Shadows' bonus once per landed hit tick, not as one lump sum at the placement's start tick (Rapid Fire: +5 per tick over its 8 hit ticks)", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'imbue', abilityName: imbueShadows.name, startTick: 0 }, // -40, target: 'Self'
			{ id: 'rf', abilityName: rapidFire.name, startTick: 5 } // -25, 8 hits at ticks 5-12
		];
		const states = resolveAdrenaline(placements, abilities, 'ranged', 100, 14);
		expect(states[4].value).toBe(60); // 100 - 40, unchanged right up to Rapid Fire's cast
		expect(states[5].value).toBe(40); // 60 - 25 (cost) + 5 (hit 1 of 8)
		expect(states[6].value).toBe(45); // + another 5 (hit 2)
		expect(states[7].value).toBe(50);
		expect(states[12].value).toBe(75); // 40 + 5*7 (hits 2 through 8)
	});

	it("applies Imbue: Shadows' per-hit bonus to a spend-type Ultimate alongside Ring of Vigour's flat refund (Deadshot at 60% adrenaline, no igneous cape: 60 -> 0 (cost) -> 10 (Ring of Vigour) -> 30 (4 hits * 5))", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'imbue', abilityName: imbueShadows.name, startTick: 0 }, // -40, target: 'Self'
			{ id: 'ds', abilityName: deadshot.name, startTick: 5 } // -60, single placement, 4 hits per hitCountFor without an igneous cape
		];
		const states = resolveAdrenaline(placements, abilities, 'ranged', 100, 6, true);
		expect(states[4].value).toBe(60); // 100 - 40
		expect(states[5].value).toBe(30); // 60 - 60 (cost, clamped to 0) + 10 (RoV) + 5*4 (Imbue: Shadows)
	});

	it("credits Imbue: Shadows' bonus for all 8 of Deadshot's hits when Igneous Kal-Xil is equipped", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'imbue', abilityName: imbueShadows.name, startTick: 0 }, // -40, target: 'Self'
			{ id: 'ds', abilityName: deadshot.name, startTick: 5 } // -60, single placement, 8 hits with the cape
		];
		const gear: GearContext = {
			isTwoHanded: true,
			hasOffHandWeapon: false,
			equippedCapeName: 'Igneous Kal-Xil'
		};
		const states = resolveAdrenaline(
			placements,
			abilities,
			'ranged',
			100,
			6,
			true,
			false,
			{},
			false,
			gear
		);
		expect(states[4].value).toBe(60); // 100 - 40
		expect(states[5].value).toBe(50); // 60 - 60 (cost, clamped to 0) + 10 (RoV) + 5*8 (Imbue: Shadows)
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
		const placements: TimelinePlacement[] = [{ id: 'a', abilityName: revenge.name, startTick: 0 }];
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

	it("stacks additively with Meteor Strike's 1.5x melee Basic multiplier (Adaptive Strike: 13 * 1.5 = 19.5)", () => {
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

describe('isMeleeUltimate', () => {
	it('is true for a melee Ultimate (Overpower, Berserk)', () => {
		expect(isMeleeUltimate(overpower)).toBe(true);
		expect(isMeleeUltimate(berserk)).toBe(true);
	});

	it('is false for a non-Ultimate melee ability (Rend) and a non-melee Ultimate (Deadshot)', () => {
		expect(isMeleeUltimate(rend)).toBe(false);
		expect(isMeleeUltimate(deadshot)).toBe(false);
	});
});

describe('resolveHavocBuffs (Vestments of havoc set effect)', () => {
	const noPieces = {};
	const twoPieces = { [VESTMENTS_OF_HAVOC_SET_NAME]: 2 };

	it('produces no buff at all with fewer than 2 pieces equipped', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: overpower.name, startTick: 0 }
		];
		const result = resolveHavocBuffs(placements, abilities, 40, noPieces);
		expect(result.buffs).toEqual([]);
		expect(result.instantBursts).toEqual([]);
	});

	it('starts a 30-tick Havoc buff when a melee ultimate is cast with 2+ pieces equipped', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: overpower.name, startTick: 5 }
		];
		const result = resolveHavocBuffs(placements, abilities, 40, twoPieces);
		expect(result.buffs).toHaveLength(1);
		expect(result.buffs[0].abilityName).toBe('Havoc');
		expect(result.buffs[0].startTick).toBe(5);
		expect(result.buffs[0].endTick).toBe(35);
		expect(result.instantBursts).toEqual([]);
	});

	it('does not react to a non-ultimate or non-melee placement', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'a', abilityName: rend.name, startTick: 0 },
			{ id: 'b', abilityName: deadshot.name, startTick: 5 }
		];
		const result = resolveHavocBuffs(placements, abilities, 40, twoPieces);
		expect(result.buffs).toEqual([]);
	});

	it('re-triggering a melee ultimate while Havoc is active ends the window early and grants an instant burst instead of stacking a second buff', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'first', abilityName: overpower.name, startTick: 0 },
			{ id: 'second', abilityName: berserk.name, startTick: 10 } // well within the 30-tick window
		];
		const result = resolveHavocBuffs(placements, abilities, 40, twoPieces);
		expect(result.buffs).toHaveLength(1);
		expect(result.buffs[0].startTick).toBe(0);
		expect(result.buffs[0].endTick).toBe(10); // truncated at the re-trigger tick, not 30
		expect(result.instantBursts).toEqual([
			{ placementId: 'second', tick: 10, percent: HAVOC_INSTANT_BURST_PERCENT }
		]);
	});

	it('a melee ultimate cast AFTER Havoc has naturally expired starts a fresh window, not a burst', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'first', abilityName: overpower.name, startTick: 0 },
			{ id: 'second', abilityName: berserk.name, startTick: 30 } // exactly at/after endTick
		];
		const result = resolveHavocBuffs(placements, abilities, 70, twoPieces);
		expect(result.buffs).toHaveLength(2);
		expect(result.buffs[1].startTick).toBe(30);
		expect(result.instantBursts).toEqual([]);
	});
});

describe('applyVestmentsBerserkExtension (3-piece bonus)', () => {
	it('extends Berserk by 10 ticks with 3+ pieces equipped', () => {
		const buffs = [
			{ placementId: 'b', abilityName: 'Berserk', startTick: 0, endTick: 34, extensions: [] }
		];
		const extended = applyVestmentsBerserkExtension(
			buffs,
			{ [VESTMENTS_OF_HAVOC_SET_NAME]: 3 },
			100
		);
		expect(extended[0].endTick).toBe(44);
	});

	it('leaves Berserk unchanged with fewer than 3 pieces equipped', () => {
		const buffs = [
			{ placementId: 'b', abilityName: 'Berserk', startTick: 0, endTick: 34, extensions: [] }
		];
		const extended = applyVestmentsBerserkExtension(
			buffs,
			{ [VESTMENTS_OF_HAVOC_SET_NAME]: 2 },
			100
		);
		expect(extended[0].endTick).toBe(34);
	});

	it('leaves other buffs (e.g. Havoc itself) untouched', () => {
		const buffs = [
			{ placementId: 'h', abilityName: 'Havoc', startTick: 0, endTick: 30, extensions: [] }
		];
		const extended = applyVestmentsBerserkExtension(
			buffs,
			{ [VESTMENTS_OF_HAVOC_SET_NAME]: 4 },
			100
		);
		expect(extended[0].endTick).toBe(30);
	});

	it('records the extension as an AppliedBuffExtension so it renders like any other extension', () => {
		const buffs = [
			{ placementId: 'b', abilityName: 'Berserk', startTick: 5, endTick: 39, extensions: [] }
		];
		const extended = applyVestmentsBerserkExtension(
			buffs,
			{ [VESTMENTS_OF_HAVOC_SET_NAME]: 3 },
			100
		);
		expect(extended[0].extensions).toEqual([
			{ tick: 5, extendTicks: 10, sourceAbilityName: 'Vestments of havoc (3pc)' }
		]);
	});

	it('clamps the recorded extendTicks when the timeline cuts it off early', () => {
		const buffs = [
			{ placementId: 'b', abilityName: 'Berserk', startTick: 0, endTick: 34, extensions: [] }
		];
		const extended = applyVestmentsBerserkExtension(
			buffs,
			{ [VESTMENTS_OF_HAVOC_SET_NAME]: 3 },
			38
		);
		expect(extended[0].endTick).toBe(38);
		expect(extended[0].extensions).toEqual([
			{ tick: 0, extendTicks: 4, sourceAbilityName: 'Vestments of havoc (3pc)' }
		]);
	});
});

describe('resolveAllBuffs', () => {
	it('merges ordinary buffs with Havoc set-effect buffs into one array', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'berserk', abilityName: berserk.name, startTick: 0 },
			// Berserk is ALSO a melee ultimate, so it starts its own Havoc window (0-30) --
			// Overpower's cast at 40 is after that window naturally expired, so it starts a
			// second, independent Havoc instance rather than re-triggering the first.
			{ id: 'op', abilityName: overpower.name, startTick: 40 }
		];
		const result = resolveAllBuffs(placements, abilities, 100, {
			[VESTMENTS_OF_HAVOC_SET_NAME]: 4
		});
		const names = result.buffs.map((b) => b.abilityName).sort();
		expect(names).toEqual(['Berserk', 'Havoc', 'Havoc']);
		// 3pc+4pc means the set is fully equipped -- Berserk's 33-tick base duration should be
		// extended by 10 (43).
		const berserkBuff = result.buffs.find((b) => b.abilityName === 'Berserk')!;
		expect(berserkBuff.endTick).toBe(43);
		const havocBuffs = result.buffs.filter((b) => b.abilityName === 'Havoc');
		expect(havocBuffs.map((b) => b.startTick).sort((a, b) => a - b)).toEqual([0, 40]);
	});

	it('defaults to no set effects when setPieceCounts is omitted', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'berserk', abilityName: berserk.name, startTick: 0 }
		];
		const result = resolveAllBuffs(placements, abilities, 40);
		expect(result.buffs).toHaveLength(1);
		expect(result.buffs[0].endTick).toBe(33); // unextended
		expect(result.havocInstantBursts).toEqual([]);
	});
});

describe('resolveAdrenaline with Vestments of havoc set effects', () => {
	const twoPieces = { [VESTMENTS_OF_HAVOC_SET_NAME]: 2 };

	it('regenerates 0.5%/tick for 30 ticks after a melee ultimate while 2+ pieces are equipped', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'op', abilityName: overpower.name, startTick: 0 } // -60, so starts at 40 after cost
		];
		const states = resolveAdrenaline(
			placements,
			abilities,
			'melee',
			100,
			35,
			false,
			false,
			twoPieces,
			true
		);
		// tick 0: 100 - 60 = 40 (Havoc doesn't start its regen until the tick after activation,
		// same convention as Meteor Strike's own perTickIncome -- confirmed by the wiki's own
		// note that timing a re-trigger at exactly 18s only nets 14.5%, not the full 15%, since
		// the window's own last tick (30, exclusive) never delivers a dose).
		expect(states[0].value).toBe(40);
		expect(states[1].value).toBeCloseTo(40.5, 5);
		expect(states[29].value).toBeCloseTo(40 + 29 * (HAVOC_REGEN_PERCENT / 30), 5); // 54.5
	});

	it('does not regenerate anything with fewer than 2 pieces equipped', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'op', abilityName: overpower.name, startTick: 0 }
		];
		const states = resolveAdrenaline(placements, abilities, 'melee', 100, 35, false, false, {});
		expect(states[30].value).toBe(40);
	});

	it('re-triggering a melee ultimate while Havoc is active grants an instant +20% and stops the regen', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'first', abilityName: overpower.name, startTick: 0 }, // 100 -> 40, Havoc starts
			{ id: 'second', abilityName: berserk.name, startTick: 10 } // -100 spend, then +20 burst
		];
		const states = resolveAdrenaline(
			placements,
			abilities,
			'melee',
			100,
			40,
			false,
			false,
			twoPieces,
			true
		);
		// Just before the second cast: 40 + 4.5 ticks' worth of regen (ticks 1-9 => 9 * 0.5 = 4.5).
		expect(states[9].value).toBeCloseTo(44.5, 5);
		// tick 10: Berserk costs 100 (clamped to 0), then the instant 20% burst lands the same tick.
		expect(states[10].value).toBe(20);
		// No further regen afterwards -- the Havoc window ended at the re-trigger.
		expect(states[20].value).toBe(20);
	});

	it('raises the adrenaline cap to 120 with 4 pieces equipped and a melee weapon active', () => {
		const placements: TimelinePlacement[] = [];
		const states = resolveAdrenaline(
			placements,
			abilities,
			'melee',
			100,
			5,
			false,
			false,
			{ [VESTMENTS_OF_HAVOC_SET_NAME]: 4 },
			true
		);
		expect(states.every((s) => s.value === 100)).toBe(true);
	});

	it('the 4-piece cap raise actually allows exceeding 100', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'op', abilityName: overpower.name, startTick: 0 },
			{ id: 'berserk', abilityName: berserk.name, startTick: 3 } // re-trigger burst while active
		];
		const states = resolveAdrenaline(
			placements,
			abilities,
			'melee',
			110,
			10,
			false,
			false,
			{ [VESTMENTS_OF_HAVOC_SET_NAME]: 4 },
			true
		);
		// 110 (starting, only reachable because the cap is already 120) -60 = 50, then a later
		// instant burst can push back up past 100 without being clamped to the old 100 ceiling.
		expect(states[0].value).toBe(50);
		expect(states[0].cap).toBe(VESTMENTS_OF_HAVOC_4PC_ADRENALINE_CAP);
	});

	it('the cap stays at 100 with 4 pieces equipped but no melee weapon active', () => {
		const placements: TimelinePlacement[] = [];
		const states = resolveAdrenaline(
			placements,
			abilities,
			'melee',
			100,
			5,
			false,
			false,
			{ [VESTMENTS_OF_HAVOC_SET_NAME]: 4 },
			false
		);
		expect(states[0].cap).toBe(100);
	});
});

describe('resolveBloodlust with Vestments of havoc 3-piece Berserk extension', () => {
	it("extends the window Berserk's Bloodlust cap raise/2x multiplier stay active for", () => {
		const placements: TimelinePlacement[] = [
			{ id: 'berserk', abilityName: berserk.name, startTick: 0 }, // 33-tick base -> 43 with 3pc
			{ id: 'a', abilityName: rend.name, startTick: 40 } // +2*2=4 if Berserk's window still active
		];
		const withSet = resolveBloodlust(placements, abilities, 45, {
			[VESTMENTS_OF_HAVOC_SET_NAME]: 3
		});
		const withoutSet = resolveBloodlust(placements, abilities, 45, {});
		// With the 3pc extension, Berserk's window (now ending at 43) still covers tick 40: cap
		// stays 8 and Rend's 2 stacks double to 4, landing at 4 (Berserk's own) + 4 = 8.
		expect(withSet[40].value).toBe(8);
		// Without it, Berserk's window already ended at 33 -- the cap has reverted to the base 4
		// by tick 40, so Rend's own +2 (unboosted) is clamped straight back down to the cap that
		// Berserk's initial 4-stack grant already filled.
		expect(withoutSet[40].value).toBe(4);
	});
});

describe('resolveGreaterFuryBuffs', () => {
	it('starts a 25-tick buff on cast, consumed by the next damaging placement', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'gf', abilityName: greaterFury.name, startTick: 0 },
			{ id: 'hit', abilityName: rend.name, startTick: 10 }
		];
		const { buffs, critPlacementIds } = resolveGreaterFuryBuffs(
			placements,
			abilities,
			GREATER_FURY_DURATION_TICKS + 5,
			NEUTRAL_GEAR
		);
		expect(buffs).toHaveLength(1);
		expect(buffs[0].abilityName).toBe('Greater Fury');
		expect(buffs[0].startTick).toBe(0);
		// Consumed at tick 10, well within its natural 25-tick duration -- ends right there.
		expect(buffs[0].endTick).toBe(10);
		expect(critPlacementIds).toEqual(new Set(['hit']));
	});

	it('is not consumed by a non-damaging placement (e.g. Surge)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'gf', abilityName: greaterFury.name, startTick: 0 },
			{ id: 'surge', abilityName: surge.name, startTick: 5 },
			{ id: 'hit', abilityName: rend.name, startTick: 10 }
		];
		const { buffs, critPlacementIds } = resolveGreaterFuryBuffs(
			placements,
			abilities,
			GREATER_FURY_DURATION_TICKS + 5,
			NEUTRAL_GEAR
		);
		expect(buffs[0].endTick).toBe(10);
		expect(critPlacementIds).toEqual(new Set(['hit']));
	});

	it('expires naturally after 25 ticks if never consumed', () => {
		const placements: TimelinePlacement[] = [{ id: 'gf', abilityName: greaterFury.name, startTick: 0 }];
		const { buffs, critPlacementIds } = resolveGreaterFuryBuffs(
			placements,
			abilities,
			GREATER_FURY_DURATION_TICKS + 5,
			NEUTRAL_GEAR
		);
		expect(buffs[0].endTick).toBe(GREATER_FURY_DURATION_TICKS);
		expect(critPlacementIds.size).toBe(0);
	});

	it('does not consume a damaging placement landing after the buff already expired', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'gf', abilityName: greaterFury.name, startTick: 0 },
			{ id: 'hit', abilityName: rend.name, startTick: GREATER_FURY_DURATION_TICKS + 2 }
		];
		const { critPlacementIds } = resolveGreaterFuryBuffs(
			placements,
			abilities,
			GREATER_FURY_DURATION_TICKS + 5,
			NEUTRAL_GEAR
		);
		expect(critPlacementIds.size).toBe(0);
	});
});

describe('damageByTick with Greater Fury crit', () => {
	it('multiplies the consuming placement damage by 1.5x', () => {
		const placements: TimelinePlacement[] = [{ id: 'hit', abilityName: rend.name, startTick: 0 }];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 5);
		const crit = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			5,
			new Set(['hit'])
		);
		expect(crit[0]).toBe(Math.floor(base[0] * GREATER_FURY_CRIT_MULTIPLIER));
	});
});

describe('resolveChaosRoarBuffs', () => {
	it('starts a 12-tick buff on cast, consumed by the next damaging placement', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'cr', abilityName: chaosRoar.name, startTick: 0 },
			{ id: 'hit', abilityName: rend.name, startTick: 5 }
		];
		const { buffs, bonusPlacementIds } = resolveChaosRoarBuffs(
			placements,
			abilities,
			CHAOS_ROAR_DURATION_TICKS + 5,
			NEUTRAL_GEAR
		);
		expect(buffs).toHaveLength(1);
		expect(buffs[0].abilityName).toBe('Chaos Roar');
		expect(buffs[0].startTick).toBe(0);
		expect(buffs[0].endTick).toBe(5);
		expect(bonusPlacementIds).toEqual(new Set(['hit']));
	});

	it('is not consumed by a non-damaging placement (e.g. Surge)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'cr', abilityName: chaosRoar.name, startTick: 0 },
			{ id: 'surge', abilityName: surge.name, startTick: 3 },
			{ id: 'hit', abilityName: rend.name, startTick: 5 }
		];
		const { buffs, bonusPlacementIds } = resolveChaosRoarBuffs(
			placements,
			abilities,
			CHAOS_ROAR_DURATION_TICKS + 5,
			NEUTRAL_GEAR
		);
		expect(buffs[0].endTick).toBe(5);
		expect(bonusPlacementIds).toEqual(new Set(['hit']));
	});

	it('expires naturally after 12 ticks if never consumed', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'cr', abilityName: chaosRoar.name, startTick: 0 }
		];
		const { buffs, bonusPlacementIds } = resolveChaosRoarBuffs(
			placements,
			abilities,
			CHAOS_ROAR_DURATION_TICKS + 5,
			NEUTRAL_GEAR
		);
		expect(buffs[0].endTick).toBe(CHAOS_ROAR_DURATION_TICKS);
		expect(bonusPlacementIds.size).toBe(0);
	});

	it('does not consume a damaging placement landing after the buff already expired', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'cr', abilityName: chaosRoar.name, startTick: 0 },
			{ id: 'hit', abilityName: rend.name, startTick: CHAOS_ROAR_DURATION_TICKS + 2 }
		];
		const { bonusPlacementIds } = resolveChaosRoarBuffs(
			placements,
			abilities,
			CHAOS_ROAR_DURATION_TICKS + 5,
			NEUTRAL_GEAR
		);
		expect(bonusPlacementIds.size).toBe(0);
	});
});

describe('damageByTick with Chaos Roar bonus', () => {
	it('multiplies a single-hit ability by 1.75x', () => {
		const placements: TimelinePlacement[] = [{ id: 'hit', abilityName: rend.name, startTick: 0 }];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 5);
		const boosted = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			5,
			new Set(),
			new Set(),
			new Set(['hit'])
		);
		expect(boosted[0]).toBe(Math.floor(base[0] * CHAOS_ROAR_DAMAGE_MULTIPLIER));
	});

	it('only boosts the FIRST hit of a channelled ability, not every hit', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'assault', abilityName: assault.name, startTick: 0 }
		];
		const base = damageByTick(placements, abilities, 5000, NEUTRAL_GEAR, 10);
		const boosted = damageByTick(
			placements,
			abilities,
			5000,
			NEUTRAL_GEAR,
			10,
			new Set(),
			new Set(),
			new Set(['assault'])
		);
		const channels = resolveChannels(placements, abilities, 10);
		const [firstTick, ...restTicks] = channels[0].hitTicks;
		expect(boosted[firstTick]).toBe(Math.floor(base[firstTick] * CHAOS_ROAR_DAMAGE_MULTIPLIER));
		for (const tick of restTicks) {
			expect(boosted[tick]).toBe(base[tick]);
		}
	});

	it('boosts ALL hits of a genuine bleed ability (BLEED_ABILITY_NAMES)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'dismember', abilityName: dismember.name, startTick: 0 }
		];
		const base = damageByTick(placements, abilities, 5000, NEUTRAL_GEAR, 20);
		const boosted = damageByTick(
			placements,
			abilities,
			5000,
			NEUTRAL_GEAR,
			20,
			new Set(),
			new Set(),
			new Set(['dismember'])
		);
		const channels = resolveChannels(placements, abilities, 20);
		for (const tick of channels[0].hitTicks) {
			expect(boosted[tick]).toBe(Math.floor(base[tick] * CHAOS_ROAR_DAMAGE_MULTIPLIER));
		}
	});

	it('only boosts the first hit of a Greater-Barge-converted channel, NOT all hits', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'assault', abilityName: assault.name, startTick: 0 }
		];
		const bargeBleedIds = new Set(['assault']);
		const base = damageByTick(
			placements,
			abilities,
			5000,
			NEUTRAL_GEAR,
			10,
			new Set(),
			bargeBleedIds
		);
		const boosted = damageByTick(
			placements,
			abilities,
			5000,
			NEUTRAL_GEAR,
			10,
			new Set(),
			bargeBleedIds,
			new Set(['assault'])
		);
		const channels = resolveChannels(placements, abilities, 10, bargeBleedIds);
		expect(channels[0].isBleed).toBe(true); // exempted from interruption, styled as a bleed...
		const [firstTick, ...restTicks] = channels[0].hitTicks;
		// ...but still only the first hit gets Chaos Roar's bonus, since it isn't a GENUINE bleed.
		expect(boosted[firstTick]).toBe(Math.floor(base[firstTick] * CHAOS_ROAR_DAMAGE_MULTIPLIER));
		for (const tick of restTicks) {
			expect(boosted[tick]).toBe(base[tick]);
		}
	});
});

describe('damageByTick with Berserk active', () => {
	it('multiplies a melee ability by 1.75x when its start tick falls within a Berserk window', () => {
		const placements: TimelinePlacement[] = [{ id: 'hit', abilityName: rend.name, startTick: 5 }];
		const berserkBuffs = [
			{ placementId: 'b', abilityName: 'Berserk', startTick: 0, endTick: 33, extensions: [] }
		];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 10);
		const boosted = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			10,
			new Set(),
			new Set(),
			new Set(),
			berserkBuffs
		);
		expect(boosted[5]).toBe(Math.floor(base[5] * BERSERK_MELEE_DAMAGE_MULTIPLIER));
	});

	it('does not boost a ranged ability, even while Berserk is active', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'hit', abilityName: rangedBasic.name, startTick: 5 }
		];
		const berserkBuffs = [
			{ placementId: 'b', abilityName: 'Berserk', startTick: 0, endTick: 33, extensions: [] }
		];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 10);
		const boosted = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			10,
			new Set(),
			new Set(),
			new Set(),
			berserkBuffs
		);
		expect(boosted[5]).toBe(base[5]);
	});

	it('does not boost a melee ability placed outside the Berserk window', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'hit', abilityName: rend.name, startTick: 40 }
		];
		const berserkBuffs = [
			{ placementId: 'b', abilityName: 'Berserk', startTick: 0, endTick: 33, extensions: [] }
		];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 45);
		const boosted = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			45,
			new Set(),
			new Set(),
			new Set(),
			berserkBuffs
		);
		expect(boosted[40]).toBe(base[40]);
	});
});

describe('damageByTick with hitChanceByStyle', () => {
	it('scales a matching-style ability by hitChance / 100', () => {
		const placements: TimelinePlacement[] = [{ id: 'hit', abilityName: rend.name, startTick: 5 }];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 10);
		const scaled = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			10,
			new Set(),
			new Set(),
			new Set(),
			[],
			[],
			[],
			{ melee: 80 }
		);
		expect(scaled[5]).toBe(Math.floor(base[5] * 0.8));
	});

	it('leaves an ability untouched when its style has no entry in hitChanceByStyle', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'hit', abilityName: rangedBasic.name, startTick: 5 }
		];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 10);
		const scaled = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			10,
			new Set(),
			new Set(),
			new Set(),
			[],
			[],
			[],
			{ melee: 80 }
		);
		expect(scaled[5]).toBe(base[5]);
	});

	it('defaults to 100% (no change) when hitChanceByStyle is omitted entirely', () => {
		const placements: TimelinePlacement[] = [{ id: 'hit', abilityName: rend.name, startTick: 5 }];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 10);
		const withEmptyMap = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			10,
			new Set(),
			new Set(),
			new Set(),
			[],
			[],
			[],
			{}
		);
		expect(withEmptyMap[5]).toBe(base[5]);
	});
});

describe('igneous Kal-Zuk (and its style-specific variants) improve ultimate abilities', () => {
	const withCape = (capeName: string): GearContext => ({
		isTwoHanded: true,
		hasOffHandWeapon: false,
		equippedCapeName: capeName
	});

	it('Overpower: 1 hit normally, 2 hits with Igneous Kal-Ket or Igneous Kal-Zuk', () => {
		expect(hitCountFor(overpower, NEUTRAL_GEAR)).toBe(1);
		expect(hitCountFor(overpower, withCape('Igneous Kal-Ket'))).toBe(2);
		expect(hitCountFor(overpower, withCape('Igneous Kal-Zuk'))).toBe(2);
		expect(resolveDamagePercent(overpower, NEUTRAL_GEAR)).toBe('545%');
		expect(resolveDamagePercent(overpower, withCape('Igneous Kal-Zuk'))).toBe('620%');
	});

	it('Deadshot: 4 hits normally, 8 hits with Igneous Kal-Xil or Igneous Kal-Zuk', () => {
		expect(hitCountFor(deadshot, NEUTRAL_GEAR)).toBe(4);
		expect(hitCountFor(deadshot, withCape('Igneous Kal-Xil'))).toBe(8);
		expect(hitCountFor(deadshot, withCape('Igneous Kal-Zuk'))).toBe(8);
		expect(resolveDamagePercent(deadshot, NEUTRAL_GEAR)).toBe('460%');
		expect(resolveDamagePercent(deadshot, withCape('Igneous Kal-Zuk'))).toBe('520%');
	});

	it('Omnipower: 1 hit normally, 4 hits with Igneous Kal-Mej or Igneous Kal-Zuk', () => {
		expect(hitCountFor(omnipower, NEUTRAL_GEAR)).toBe(1);
		expect(hitCountFor(omnipower, withCape('Igneous Kal-Mej'))).toBe(4);
		expect(hitCountFor(omnipower, withCape('Igneous Kal-Zuk'))).toBe(4);
		expect(resolveDamagePercent(omnipower, NEUTRAL_GEAR)).toBe('460%');
		expect(resolveDamagePercent(omnipower, withCape('Igneous Kal-Zuk'))).toBe('540%');
	});

	it('Death Skulls: bounces up to 4 times normally, 6 times with Igneous Kal-Mor or Igneous Kal-Zuk', () => {
		expect(hitCountFor(deathSkulls, NEUTRAL_GEAR)).toBe(4);
		expect(hitCountFor(deathSkulls, withCape('Igneous Kal-Mor'))).toBe(6);
		expect(hitCountFor(deathSkulls, withCape('Igneous Kal-Zuk'))).toBe(6);
		expect(resolveDamagePercent(deathSkulls, NEUTRAL_GEAR)).toBe('250%-750%');
		expect(resolveDamagePercent(deathSkulls, withCape('Igneous Kal-Zuk'))).toBe('250%-1000%');
	});

	it('resolveHitCountVariant returns null for abilities with no gear-dependent hit count', () => {
		expect(resolveHitCountVariant(rend, NEUTRAL_GEAR)).toBeNull();
	});

	it('an unrelated equipped cape does not trigger the bonus', () => {
		const gear = withCape('Completionist cape');
		expect(hitCountFor(deadshot, gear)).toBe(4);
		expect(resolveDamagePercent(deadshot, gear)).toBe('460%');
	});
});

describe('damageByTick with Searing Winds bonus', () => {
	const searingWindsBuff = (endTick: number) => [
		{ placementId: 'sw', abilityName: 'Galeshot', startTick: 0, endTick, extensions: [] }
	];

	it('adds a flat 20% of adTotal bonus to a single-hit Ranged ability while active', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'hit', abilityName: rangedBasic.name, startTick: 5 }
		];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 10);
		const boosted = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			10,
			new Set(),
			new Set(),
			new Set(),
			[],
			searingWindsBuff(9)
		);
		expect(boosted[5]).toBe(base[5] + Math.floor(10000 * SEARING_WINDS_BONUS_PERCENT));
	});

	it('does not boost a non-Ranged ability, even while Searing Winds is active', () => {
		const placements: TimelinePlacement[] = [{ id: 'hit', abilityName: rend.name, startTick: 5 }];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 10);
		const boosted = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			10,
			new Set(),
			new Set(),
			new Set(),
			[],
			searingWindsBuff(9)
		);
		expect(boosted[5]).toBe(base[5]);
	});

	it('does not boost a hit landing after Searing Winds has expired', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'hit', abilityName: rangedBasic.name, startTick: 10 }
		];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 15);
		const boosted = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			15,
			new Set(),
			new Set(),
			new Set(),
			[],
			searingWindsBuff(9)
		);
		expect(boosted[10]).toBe(base[10]);
	});

	it('still fully benefits a hit landing on the exact tick Searing Winds runs out', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'hit', abilityName: rangedBasic.name, startTick: 9 }
		];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 12);
		const boosted = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			12,
			new Set(),
			new Set(),
			new Set(),
			[],
			searingWindsBuff(9)
		);
		expect(boosted[9]).toBe(base[9] + Math.floor(10000 * SEARING_WINDS_BONUS_PERCENT));
	});

	it('credits the bonus once per landed hit of a channelled ability (Rapid Fire, 8 hits)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'rf', abilityName: rapidFire.name, startTick: 0 }
		];
		const base = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 20);
		const boosted = damageByTick(
			placements,
			abilities,
			10000,
			NEUTRAL_GEAR,
			20,
			new Set(),
			new Set(),
			new Set(),
			[],
			searingWindsBuff(20)
		);
		const channels = resolveChannels(placements, abilities, 20);
		const bonusPerHit = Math.floor(10000 * SEARING_WINDS_BONUS_PERCENT);
		for (const tick of channels[0].hitTicks) {
			expect(boosted[tick]).toBe(base[tick] + bonusPerHit);
		}
	});

	it('credits the bonus once per simultaneous hit of a gear-dependent multi-hit ability (Deadshot, 8 hits with Igneous Kal-Xil)', () => {
		const gear: GearContext = {
			isTwoHanded: true,
			hasOffHandWeapon: false,
			equippedCapeName: 'Igneous Kal-Xil'
		};
		const placements: TimelinePlacement[] = [
			{ id: 'ds', abilityName: deadshot.name, startTick: 5 }
		];
		const base = damageByTick(placements, abilities, 10000, gear, 10);
		const boosted = damageByTick(
			placements,
			abilities,
			10000,
			gear,
			10,
			new Set(),
			new Set(),
			new Set(),
			[],
			searingWindsBuff(9)
		);
		const bonusPerHit = Math.floor(10000 * SEARING_WINDS_BONUS_PERCENT);
		expect(boosted[5]).toBe(base[5] + bonusPerHit * hitCountFor(deadshot, gear));
	});
});

describe("damageByTick splits a 'single'-profile multi-hit ability's damage per-hit, capped independently", () => {
	it('Ricochet (3 hits) caps each hit at MAX_DAMAGE_PER_HIT independently, not the whole total', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'ricochet', abilityName: ricochet.name, startTick: 0 }
		];
		const result = damageByTick(placements, abilities, 1_000_000, NEUTRAL_GEAR, 5);
		const perHitDamage = Math.floor(
			abilityDamageForPlacement(ricochet, 1_000_000, NEUTRAL_GEAR) / hitCountFor(ricochet, NEUTRAL_GEAR)
		);
		expect(perHitDamage).toBeGreaterThan(MAX_DAMAGE_PER_HIT);
		// Ricochet's hits land at offsets [0, 1, 1] from its placement tick (per damagesOnTick):
		// the initial hit on tick 0, and the two ricochet hits together on tick 1.
		expect(result[0]).toBe(MAX_DAMAGE_PER_HIT);
		expect(result[1]).toBe(MAX_DAMAGE_PER_HIT * 2);
	});

	it("a genuinely single-hit ability's damage is unaffected by the per-hit split (hitCount 1)", () => {
		const placements: TimelinePlacement[] = [{ id: 'hit', abilityName: rend.name, startTick: 0 }];
		const result = damageByTick(placements, abilities, 10000, NEUTRAL_GEAR, 5);
		expect(result[0]).toBe(
			Math.min(abilityDamageForPlacement(rend, 10000, NEUTRAL_GEAR), MAX_DAMAGE_PER_HIT)
		);
	});
});

describe('MAX_DAMAGE_PER_HIT cap', () => {
	it('caps a single-hit ability at 30,000 even with a huge AD total', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'op', abilityName: overpower.name, startTick: 0 }
		];
		const result = damageByTick(placements, abilities, 1_000_000, NEUTRAL_GEAR, 5);
		expect(result[0]).toBe(MAX_DAMAGE_PER_HIT);
	});

	it('caps each individual hit of a channelled ability independently', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'assault', abilityName: assault.name, startTick: 0 }
		];
		const result = damageByTick(placements, abilities, 1_000_000, NEUTRAL_GEAR, 10);
		const channels = resolveChannels(placements, abilities, 10);
		for (const tick of channels[0].hitTicks) {
			expect(result[tick]).toBe(MAX_DAMAGE_PER_HIT);
		}
	});

	it('leaves ordinary damage well under the cap unaffected', () => {
		const placements: TimelinePlacement[] = [{ id: 'hit', abilityName: rend.name, startTick: 0 }];
		const result = damageByTick(placements, abilities, 1000, NEUTRAL_GEAR, 5);
		expect(result[0]).toBeLessThan(MAX_DAMAGE_PER_HIT);
		expect(result[0]).toBeGreaterThan(0);
	});

	it('a crit that would exceed the cap is still clamped down to it', () => {
		const placements: TimelinePlacement[] = [{ id: 'hit', abilityName: rend.name, startTick: 0 }];
		const result = damageByTick(
			placements,
			abilities,
			1_000_000,
			NEUTRAL_GEAR,
			5,
			new Set(['hit'])
		);
		expect(result[0]).toBe(MAX_DAMAGE_PER_HIT);
	});
});

describe('resolveEndlessAssaultBleeds', () => {
	it('grants Endless Assault when Greater Barge is the very first placement (nothing prior)', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'barge', abilityName: greaterBarge.name, startTick: 0 }
		];
		const { buffs } = resolveEndlessAssaultBleeds(placements, abilities, 15, NEUTRAL_GEAR);
		expect(buffs).toHaveLength(1);
		expect(buffs[0].abilityName).toBe('Endless Assault');
		expect(buffs[0].startTick).toBe(0);
		expect(buffs[0].endTick).toBe(GREATER_BARGE_BLEED_WINDOW_TICKS);
	});

	it('grants Endless Assault when 8+ ticks have passed since the last damaging ability', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'hit', abilityName: rend.name, startTick: 0 },
			{ id: 'barge', abilityName: greaterBarge.name, startTick: GREATER_BARGE_OUT_OF_COMBAT_TICKS }
		];
		const { buffs } = resolveEndlessAssaultBleeds(placements, abilities, 30, NEUTRAL_GEAR);
		expect(buffs).toHaveLength(1);
	});

	it('withholds Endless Assault when fewer than 8 ticks have passed since a damaging ability', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'hit', abilityName: rend.name, startTick: 0 },
			{
				id: 'barge',
				abilityName: greaterBarge.name,
				startTick: GREATER_BARGE_OUT_OF_COMBAT_TICKS - 1
			}
		];
		const { buffs } = resolveEndlessAssaultBleeds(placements, abilities, 30, NEUTRAL_GEAR);
		expect(buffs).toHaveLength(0);
	});

	it('a non-damaging ability (e.g. Berserk) does not reset the out-of-combat timer', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'hit', abilityName: rend.name, startTick: 0 },
			{ id: 'zerk', abilityName: berserk.name, startTick: 3 },
			{ id: 'barge', abilityName: greaterBarge.name, startTick: GREATER_BARGE_OUT_OF_COMBAT_TICKS }
		];
		const { buffs } = resolveEndlessAssaultBleeds(placements, abilities, 30, NEUTRAL_GEAR);
		// Still measured from Rend (tick 0), not Berserk (tick 3) -- Berserk deals no damage itself.
		expect(buffs).toHaveLength(1);
	});

	it('converts the next melee channelled ability into a bypass-interruption bleed', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'barge', abilityName: greaterBarge.name, startTick: 0 },
			{ id: 'channel', abilityName: assault.name, startTick: 2 },
			// Placed mid-channel -- would normally truncate Assault's remaining hits.
			{ id: 'interrupter', abilityName: rend.name, startTick: 5 }
		];
		const { bleedPlacementIds } = resolveEndlessAssaultBleeds(placements, abilities, 15, NEUTRAL_GEAR);
		expect(bleedPlacementIds).toEqual(new Set(['channel']));

		const channels = resolveChannels(placements, abilities, 15, bleedPlacementIds);
		const assaultChannel = channels.find((c) => c.placementId === 'channel')!;
		// All 4 natural hits land (2, 4, 6, 8) despite Rend being placed at tick 5.
		expect(assaultChannel.hitTicks).toEqual([2, 4, 6, 8]);
		expect(assaultChannel.isBleed).toBe(true);
	});

	it('does not treat a single-hit ability as consuming the Endless Assault window', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'barge', abilityName: greaterBarge.name, startTick: 0 },
			{ id: 'hit', abilityName: rend.name, startTick: 2 },
			{ id: 'channel', abilityName: assault.name, startTick: 5 }
		];
		const { buffs, bleedPlacementIds } = resolveEndlessAssaultBleeds(
			placements,
			abilities,
			20,
			NEUTRAL_GEAR
		);
		// Rend (single-hit) doesn't consume the window -- Assault at tick 5 (still within the
		// 10-tick window) is the one that does.
		expect(bleedPlacementIds).toEqual(new Set(['channel']));
		expect(buffs[0].endTick).toBe(5);
	});
});

describe('resolveChannels with bleedPlacementIds', () => {
	it('an ordinary (non-bleed) channel is still truncated by a later placement as before', () => {
		const placements: TimelinePlacement[] = [
			{ id: 'channel', abilityName: assault.name, startTick: 0 },
			{ id: 'interrupter', abilityName: rend.name, startTick: 3 }
		];
		const channels = resolveChannels(placements, abilities, 15);
		expect(channels[0].hitTicks).toEqual([0, 2]);
		expect(channels[0].isBleed).toBe(false);
	});
});
