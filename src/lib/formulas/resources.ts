/**
 * A generic tick-by-tick resource gauge engine -- the shared shape behind Adrenaline and Bloodlust
 * (and, later, resources like the Bow of the Last Guardian's Perfect Equilibrium stacks), replacing
 * what used to be two independently hand-rolled, structurally identical resolvers.
 */
import type { Ability } from '../data/abilities';
import type { ResolvedBuff, TimelinePlacement } from './timeline';
import { resolveAspect, type Modifier, type ModifierContext } from './modifiers';

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
}

function clamp(value: number, cap: number): number {
	return Math.max(0, Math.min(cap, value));
}

/**
 * Simulates `definition`'s gauge across the whole timeline, tick by tick: on every tick, resolves
 * the active cap (`resolveAspect(..., 'cap', ...)`, e.g. Berserk raising Bloodlust's ceiling); then,
 * for each eligible placement landing on that tick, applies its consume amount (if enough is
 * banked), then its signed generate amount adjusted by `generateBonus`/`generateMultiplier` (if
 * generating) or followed by `costRefund` (if spending, e.g. Ring of Vigour); and only *after* that
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
	ctx: ModifierContext,
	timelineLength: number
): ResourceState[] {
	const result: ResourceState[] = new Array(timelineLength);
	const sorted = [...placements]
		.filter((p) => p.startTick >= 0 && p.startTick < timelineLength)
		.sort((a, b) => a.startTick - b.startTick);

	let value = clamp(definition.startingValue, definition.baseCap);
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
				const refund = resolveAspect(modifiers, definition.id, 'costRefund', tick, buffs, ctx, ability);
				if (refund.additive !== 0) value = clamp(value + refund.additive, cap);
			} else if (base > 0) {
				const bonus = resolveAspect(modifiers, definition.id, 'generateBonus', tick, buffs, ctx, ability);
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

		// Ambient per-tick income (e.g. Meteor Strike) applies last -- after any placement landing
		// this same tick has already spent/generated -- see the doc comment above for why.
		const perTickIncome = resolveAspect(modifiers, definition.id, 'perTickIncome', tick, buffs, ctx);
		if (perTickIncome.additive !== 0) value = clamp(value + perTickIncome.additive, cap);

		result[tick] = { value, cap, insufficientForCost };
	}

	return result;
}
