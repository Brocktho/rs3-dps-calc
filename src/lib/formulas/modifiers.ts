/**
 * A small, data-driven system for expressing "something adjusts a numeric aspect of a resource
 * under some condition" -- the shared shape behind Ring of Vigour, Berserk's Bloodlust cap raise,
 * Imbue: Shadows' adrenaline bonus, and Meteor Strike's passive income, instead of each being its
 * own one-off `if` inside a bespoke resolver. See the "Modifier & Resource Engine" plan for the
 * full design rationale.
 */
import type { Ability } from '../data/abilities';
import type { CombatStyle } from './abilityDamage';
import type { ResolvedBuff } from './timeline';

/** Only 'player' is produced/consumed today; the field exists so enemy-side debuffs (replacing the
 *  currently-unwired Effects checkboxes) don't require a breaking change to this type later. */
export type ModifierSubject = 'player' | 'enemy';

export interface ModifierSource {
	/** e.g. "Ring of Vigour", "Berserk" -- for future provenance/badge display. */
	label: string;
}

export type NumericOperation = 'add' | 'multiply' | 'override';

export interface NumericEffect {
	operation: NumericOperation;
	/** A flat number for most cases (Ring of Vigour's +10); a function of the specific ability
	 *  being evaluated for cases like Imbue: Shadows, whose bonus scales with hitCountFor(ability). */
	value: number | ((ability: Ability) => number);
}

export function resolveEffectValue(effect: NumericEffect, ability: Ability): number {
	return typeof effect.value === 'function' ? effect.value(ability) : effect.value;
}

export type ResourceAspectKind =
	| 'generateBonus' // added to a landing placement's own generation (Imbue: Shadows)
	| 'generateMultiplier' // multiplies a landing placement's own generation (Berserk's 2x Basics)
	| 'costRefund' // applied right after a placement's own spend resolves (Ring of Vigour)
	| 'perTickIncome' // ambient: fires every tick a buff window covers, independent of any
	// placement landing that tick (Meteor Strike's 4.5%/tick)
	| 'cap'; // overrides the resource's ceiling while active (Berserk -> 8 Bloodlust)

interface ResourceModifierCommon {
	subject: ModifierSubject;
	/** 'adrenaline' | 'bloodlust' (extend as new resources are declared). */
	resourceId: string;
	resourceAspect: ResourceAspectKind;
	effect: NumericEffect;
	source: ModifierSource;
	/** e.g. Ring of Vigour: Ultimate spends only; Berserk's 2x multiplier: Basics only. */
	appliesToAbility?: (ability: Ability) => boolean;
	/** An extra static gate on top of the kind-specific activation check -- e.g. Imbue: Shadows'
	 *  bonus additionally requires the player's current combat style to be Ranged. Applies to any
	 *  modifier kind, not just passives (which already have their own `isActive`). */
	requiresContext?: (ctx: ModifierContext) => boolean;
	/** perTickIncome only; defaults to 1. */
	intervalTicks?: number;
}

/** Always active given the player's current static state -- gear, unlocks, config toggles. */
export interface PassiveModifier extends ResourceModifierCommon {
	kind: 'passive';
	isActive: (ctx: ModifierContext) => boolean;
}

/** Active only while a specific ability's buff window (per resolveBuffs) covers the current tick. */
export interface BuffWindowModifier extends ResourceModifierCommon {
	kind: 'buffWindow';
	buffAbilityName: string;
}

/**
 * Reserved for Fury/Greater Barge/Perfect-Equilibrium-style effects: fires once against the next
 * placement matching a condition, then is consumed. Defined now so the shape is settled, but no
 * resolver consumes this kind yet -- there is no existing behavior it needs to reproduce.
 */
export interface TriggeredModifier extends ResourceModifierCommon {
	kind: 'triggered';
	matches: (ability: Ability) => boolean;
	expiresAfterTicks?: number;
}

export type Modifier = PassiveModifier | BuffWindowModifier | TriggeredModifier;

export interface ModifierContext {
	combatStyle: CombatStyle | null;
	ringOfVigourActive: boolean;
	furyOfTheSmallActive: boolean;
}

function isResourceModifierActive(
	modifier: Modifier,
	tick: number,
	buffs: ResolvedBuff[],
	ctx: ModifierContext
): boolean {
	if (modifier.kind === 'passive') return modifier.isActive(ctx);
	if (modifier.kind === 'buffWindow') {
		// perTickIncome is the one exception to "active starting on its own activation tick": in
		// game, casting a buff like Meteor Strike lands its cost/refund immediately, but the buff's
		// own ambient per-tick income doesn't fire until the tick AFTER activation -- confirmed
		// directly against a real sequence (Meteor Strike: 100 -> 50 on its own cast tick, with no
		// +4.5 yet; the first +4.5 lands the following tick). Every other aspect (generateMultiplier,
		// cap, generateBonus) is active starting on the activation tick itself, same as before.
		const activationOffset = modifier.resourceAspect === 'perTickIncome' ? 1 : 0;
		return buffs.some(
			(b) =>
				b.abilityName === modifier.buffAbilityName &&
				tick >= b.startTick + activationOffset &&
				tick < b.endTick
		);
	}
	// TriggeredModifier isn't resolved here -- nothing produces or consumes it yet (see plan).
	return false;
}

/**
 * Folds every modifier matching `resourceId`/`aspect` (and, for buff-window modifiers, active at
 * `tick`) into a single result: `add` effects sum, `multiply` effects combine as a product, and the
 * last matching `override` wins. This is the one place the additive-by-default /
 * multiplicative-for-damage-style-aspects stacking rule lives, rather than being re-decided per
 * resolver. `ability` is required to resolve ability-dependent effect values and
 * `appliesToAbility` gates -- omit it only for aspects that never carry such a gate (e.g. `cap`).
 */
export function resolveAspect(
	modifiers: Modifier[],
	resourceId: string,
	aspect: ResourceAspectKind,
	tick: number,
	buffs: ResolvedBuff[],
	ctx: ModifierContext,
	ability?: Ability
): { additive: number; multiplier: number; override: number | null } {
	let additive = 0;
	let multiplier = 1;
	let override: number | null = null;

	for (const modifier of modifiers) {
		if (modifier.resourceId !== resourceId || modifier.resourceAspect !== aspect) continue;
		if (modifier.appliesToAbility && (!ability || !modifier.appliesToAbility(ability))) continue;
		if (modifier.requiresContext && !modifier.requiresContext(ctx)) continue;
		if (!isResourceModifierActive(modifier, tick, buffs, ctx)) continue;

		const value = resolveEffectValue(modifier.effect, ability as Ability);
		if (modifier.effect.operation === 'add') additive += value;
		else if (modifier.effect.operation === 'multiply') multiplier *= value;
		else override = value;
	}

	return { additive, multiplier, override };
}
