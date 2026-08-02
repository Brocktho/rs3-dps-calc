/**
 * A generic tick-by-tick resource gauge engine -- the shared shape behind Adrenaline and Bloodlust
 * (and, later, resources like the Bow of the Last Guardian's Perfect Equilibrium stacks), replacing
 * what used to be two independently hand-rolled, structurally identical resolvers.
 */
import type { Ability } from '../data/abilities';
import type { ResolvedBuff, TimelinePlacement } from './timeline';
import type { TickContext } from './context';
import { resolveAspect, type Modifier } from './modifiers';

export interface ResourceState {
	value: number;
	cap: number;
	insufficientForCost: boolean;
}

export interface ResourceDefinition {
	id: string;
	baseCap: number;
	startingValue: number;
	/** 'perHit' is the shape a resource like Perfect Equilibrium will need later (a stack per
	 *  landed hit, not per placement) -- not implemented until that ability is built. */
	generationGranularity: 'perPlacement';
	/** Signed: positive generates, negative costs (and requires that much banked -- flagged via
	 *  `insufficientForCost`, never blocked). Matches `Ability.adrenaline`'s own convention. */
	generateForPlacement: (ability: Ability) => number;
	/** Unsigned. Only fires if at least this much is currently banked; silently skipped otherwise
	 *  (permissive, same as everywhere else in this app) -- e.g. Bloodlust's "consumes N stacks". */
	consumeForPlacement?: (ability: Ability) => number;
	/** Restricts which placements interact with this resource at all, e.g. Bloodlust: melee only. */
	isEligiblePlacement?: (ability: Ability) => boolean;
	/** Every tick `placement` lands a hit on -- a channel's surviving hitTicks, or hitCountFor(ability)
	 *  copies of its own startTick for a simultaneous multi-hit ability, or just [startTick] for a
	 *  plain single-hit ability. Drives per-hit resource modifiers like Imbue: Shadows: each entry
	 *  gets its own independent generateBonus/generateMultiplier resolution, regardless of whether
	 *  the placement's own generateForPlacement amount is positive or negative (a spend like Deadshot
	 *  still lands hits that are each eligible for a per-hit bonus). Optional only so resources with
	 *  no such concept (Bloodlust) don't need to supply a trivial passthrough. */
	hitTicksForPlacement?: (placement: TimelinePlacement, ability: Ability) => number[];
	/** Unsigned bonus refunded right alongside a spend-placement's own `costRefund` Modifiers (Ring
	 *  of Vigour, etc.), but resolved per EXACT PLACEMENT/TICK rather than by any static Modifier
	 *  gate -- needed for effects whose activation depends on simulation-time state the generic
	 *  Modifier system can't express (PassiveModifier.isActive/appliesToAbility only ever see the
	 *  ability, never the specific tick or placement instance), e.g. Vestments of havoc's instant
	 *  20% burst: re-triggering the Havoc buff fires only on the SPECIFIC melee-ultimate placement
	 *  that re-triggered it, not every melee ultimate cast. Optional; defaults to no bonus. */
	costRefundForPlacement?: (placement: TimelinePlacement, ability: Ability, tick: number) => number;
}

function clamp(value: number, cap: number): number {
	return Math.max(0, Math.min(cap, value));
}

/**
 * Simulates `definition`'s gauge across the whole timeline, tick by tick: on every tick, resolves
 * the active cap (`resolveAspect(..., 'cap', ...)`, e.g. Berserk raising Bloodlust's ceiling); then,
 * for each eligible placement landing on that tick, applies its consume amount (if enough is
 * banked), then its signed generate amount adjusted by `generateMultiplier` (if generating) or
 * followed by `costRefund` (if spending, e.g. Ring of Vigour), then applies `generateBonus` once per
 * entry in `hitTicksForPlacement` regardless of that sign (a per-hit bonus like Imbue: Shadows fires
 * for every landed hit even on a spend-type Ultimate like Deadshot); and only *after* all of that
 * applies any ambient `perTickIncome` for the tick (e.g. Meteor Strike's 4.5%/tick) -- all clamped
 * to the resolved cap.
 *
 * The ordering of "placement effects, then ambient income, same tick" (rather than the reverse)
 * matters and was confirmed against a real in-game sequence: casting Berserk (100% cost) on a tick
 * where Meteor Strike's ambient income is already flowing, with Ring of Vigour equipped, lands at
 * 100 -> 0 (cost) -> 10 (refund) -> 14.5 (that same tick's Meteor Strike income) -- not 10.
 *
 * Note `perTickIncome` specifically does NOT start on a buff's own activation tick (see
 * `isResourceModifierActive` in modifiers.ts) -- Meteor Strike's own cast lands at 100 -> 40 -> 50
 * with no +4.5 yet; the first tick of ambient income comes the tick after. Its `generateMultiplier`
 * (melee Basics generate 1.5x during its window), by contrast, is active starting on its own
 * activation tick, same as every other non-`perTickIncome` aspect.
 */
export function resolveResource(
	definition: ResourceDefinition,
	placements: TimelinePlacement[],
	abilities: Ability[],
	modifiers: Modifier[],
	buffs: ResolvedBuff[],
	ctx: TickContext,
	timelineLength: number
): ResourceState[] {
	const result: ResourceState[] = new Array(timelineLength);
	const sorted = [...placements]
		.filter((p) => p.startTick >= 0 && p.startTick < timelineLength)
		.sort((a, b) => a.startTick - b.startTick);

	// generateBonus modifiers are split by applicationGranularity up front: perPlacement bonuses
	// (the default, e.g. Fury of the Small) resolve once per cast; perHit bonuses (e.g. Imbue:
	// Shadows) resolve once per landed hit tick. See ResourceModifierCommon.applicationGranularity.
	const perPlacementModifiers = modifiers.filter(
		(m) =>
			m.resourceAspect !== 'generateBonus' ||
			(m.applicationGranularity ?? 'perPlacement') === 'perPlacement'
	);
	const perHitModifiers = modifiers.filter(
		(m) => m.resourceAspect === 'generateBonus' && m.applicationGranularity === 'perHit'
	);

	// Per-hit bonus events are scheduled onto the tick they actually land on (a channel's hit ticks
	// can run well past its placement's own startTick, e.g. Rapid Fire's 8 hits over 8 ticks) --
	// bucketed up front so the main loop below can apply each hit's bonus exactly when it happens,
	// the same way `perTickIncome` fires on its own tick rather than at the triggering placement's.
	const perHitBonusesByTick = new Map<number, Ability[]>();
	if (definition.hitTicksForPlacement) {
		for (const placement of placements) {
			const ability = abilities.find((a) => a.name === placement.abilityName);
			if (!ability) continue;
			if (definition.isEligiblePlacement && !definition.isEligiblePlacement(ability)) continue;
			for (const hitTick of definition.hitTicksForPlacement(placement, ability)) {
				if (hitTick < 0 || hitTick >= timelineLength) continue;
				const list = perHitBonusesByTick.get(hitTick);
				if (list) list.push(ability);
				else perHitBonusesByTick.set(hitTick, [ability]);
			}
		}
	}

	// The starting value must be clamped against whatever cap is ALREADY active at tick 0 (e.g. a
	// PassiveModifier like Vestments of havoc's 4-piece +20% adrenaline cap, which -- unlike a
	// buffWindow modifier -- has no "activation tick" and is simply always active given the
	// player's static gear) -- not unconditionally the resource's own baseCap, or a starting value
	// intentionally set above 100 would be wrongly clamped back down before the loop even begins.
	const initialCapResult = resolveAspect(modifiers, definition.id, 'cap', 0, buffs, ctx);
	let value = clamp(definition.startingValue, initialCapResult.override ?? definition.baseCap);
	let sortedIndex = 0;

	for (let tick = 0; tick < timelineLength; tick++) {
		// Deliberately not reclamped every tick when the cap shrinks (e.g. Berserk's window ending)
		// -- matches the original resolvers' behavior, which only ever clamped at the moment of a
		// generation event, not passively on every tick.
		const capResult = resolveAspect(modifiers, definition.id, 'cap', tick, buffs, ctx);
		const cap = capResult.override ?? definition.baseCap;

		let insufficientForCost = false;
		while (sortedIndex < sorted.length && sorted[sortedIndex].startTick === tick) {
			const placement = sorted[sortedIndex];
			sortedIndex++;
			const ability = abilities.find((a) => a.name === placement.abilityName);
			if (!ability) continue;
			if (definition.isEligiblePlacement && !definition.isEligiblePlacement(ability)) continue;

			if (definition.consumeForPlacement) {
				const amount = definition.consumeForPlacement(ability);
				if (amount > 0 && value >= amount) value = clamp(value - amount, cap);
			}

			const base = definition.generateForPlacement(ability);
			if (base < 0) {
				insufficientForCost = value < Math.abs(base);
				value = clamp(value + base, cap);
				const refund = resolveAspect(
					modifiers,
					definition.id,
					'costRefund',
					tick,
					buffs,
					ctx,
					ability
				);
				if (refund.additive !== 0) value = clamp(value + refund.additive, cap);
				if (definition.costRefundForPlacement) {
					const placementRefund = definition.costRefundForPlacement(placement, ability, tick);
					if (placementRefund !== 0) value = clamp(value + placementRefund, cap);
				}
			} else if (base > 0) {
				const bonus = resolveAspect(
					perPlacementModifiers,
					definition.id,
					'generateBonus',
					tick,
					buffs,
					ctx,
					ability
				);
				const multiplier = resolveAspect(
					modifiers,
					definition.id,
					'generateMultiplier',
					tick,
					buffs,
					ctx,
					ability
				);
				value = clamp(value + (base + bonus.additive) * multiplier.multiplier, cap);
			}
		}

		// Per-hit bonuses (e.g. Imbue: Shadows' 5% per landed hit) apply on the tick each hit
		// actually lands -- which for a channel can be well after its placement's own startTick
		// (Rapid Fire's 8 hits spread over 8 ticks) -- independent of whether the placement's own
		// generateForPlacement amount was a cost or a generation, since a spend-type Ultimate like
		// Deadshot still lands hits that are each eligible for this bonus. Kept separate from the
		// perPlacement generateBonus resolved above so a flat per-cast bonus like Fury of the Small
		// doesn't get multiplied by a multi-hit ability's hit count.
		for (const ability of perHitBonusesByTick.get(tick) ?? []) {
			const bonus = resolveAspect(
				perHitModifiers,
				definition.id,
				'generateBonus',
				tick,
				buffs,
				ctx,
				ability
			);
			if (bonus.additive !== 0) value = clamp(value + bonus.additive, cap);
		}

		// Ambient per-tick income (e.g. Meteor Strike) applies last -- after any placement landing
		// this same tick has already spent/generated -- see the doc comment above for why.
		const perTickIncome = resolveAspect(
			modifiers,
			definition.id,
			'perTickIncome',
			tick,
			buffs,
			ctx
		);
		if (perTickIncome.additive !== 0) value = clamp(value + perTickIncome.additive, cap);

		result[tick] = { value, cap, insufficientForCost };
	}

	return result;
}
