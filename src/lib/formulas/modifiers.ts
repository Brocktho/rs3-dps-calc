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
	/**
	 * `generateBonus` only; defaults to 'perPlacement'. 'perPlacement' resolves once for the whole
	 * placement, alongside its own base generation (Fury of the Small: +1 flat per generating cast,
	 * regardless of how many hits that cast lands). 'perHit' instead resolves once for each of the
	 * placement's own landed-hit ticks (Imbue: Shadows: +5% per hit, so a multi-hit ability like
	 * Rapid Fire or Deadshot accumulates one copy per hit) -- and, unlike perPlacement, fires even
	 * when the placement's own generateForPlacement amount is a cost rather than a generation, since
	 * a spend-type Ultimate can still land hits eligible for a per-hit bonus.
	 */
	applicationGranularity?: 'perPlacement' | 'perHit';
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
	/** How many pieces of each armour set (keyed by Armour.setName, e.g. "Vestments of havoc
	 *  armour") are currently equipped -- generalizes across every set-effect armour, not just
	 *  Vestments, so a new set only needs new Modifier entries gated on this count, never a new
	 *  ModifierContext field. Absent/0 for sets with nothing equipped. */
	setPieceCounts: Record<string, number>;
	/** Whether the player's main-hand is currently a melee weapon -- Vestments of havoc's 4-piece
	 *  bonus (+20% max adrenaline) is conditioned on this, not just the armour itself. */
	hasMeleeWeaponEquipped: boolean;
}

/**
 * Declarative description of a buff/debuff an ability can cause to exist on the timeline -- the
 * data-driven replacement for a bespoke per-effect resolver (resolveGreaterFuryBuffs,
 * resolveChaosRoarBuffs, resolveHavocBuffs, resolveEndlessAssaultBleeds, ...). One generic engine
 * (resolveEmittedBuffs in timeline.ts) reads a list of these off every ability and produces
 * ResolvedBuff windows plus the set of placements that triggered/consumed one -- no per-ability
 * code required for a NEW ability whose behavior fits an already-covered shape (e.g. any future
 * "starts on cast, consumed by next damaging hit, grants a damage multiplier" ability is just a
 * data entry, not a new resolver).
 *
 * An emission is declared on whatever ability actually causes it, in that ability's own
 * `emits: BuffEmission[]` -- `trigger: 'self'` always means "the ability this emission is
 * declared on was just cast/landed a hit." Greater Fury/Chaos Roar/Berserk each declare their own
 * self-buff directly. An emission not owned by any single ability -- Havoc (any melee Ultimate +
 * 2pc Vestments of havoc), or Gloves of Passage's item-conditional effects on Rend -- is handled
 * by attaching the SAME emission object (shared reference, not a copy) to every ability it
 * applies to: e.g. one `HAVOC_EMISSION` constant referenced from Overpower.emits, Pulverise.emits,
 * Berserk.emits, and Meteor Strike.emits alike, gated additionally by `gearCondition`. There is no
 * runtime "any ability matching a predicate" trigger -- which abilities an emission applies to is
 * decided by which abilities' data reference it, not by a function evaluated per placement.
 */
export interface BuffEmission {
	/** The buff/debuff's own display name, e.g. "Havoc", "Greater Fury", "Enduring Ruin",
	 *  "Corrupted Wounds" -- distinct from whatever ability declares the emission (mirrors
	 *  ResolvedBuff.abilityName, which for an emitted buff is this name, not the trigger's name). */
	buffName: string;
	subject: ModifierSubject;
	/** Always 'self': the ability THIS emission is declared on being cast (or landing a hit, with
	 *  `requiresDamagingHit`) starts/re-triggers it. For an emission shared across several
	 *  abilities (Havoc, Gloves of Passage), the same BuffEmission object is referenced from each
	 *  of those abilities' own `emits` arrays -- see the class doc comment above. */
	trigger: 'self';
	/** Only fires the emission on a placement that actually deals damage (Gloves of Passage: only
	 *  a successful hit from Rend applies Enduring Ruin) -- distinct from the trigger ability/
	 *  category match itself, since e.g. a non-damaging use wouldn't count as a "successful hit."
	 *  Defaults to false (every trigger match fires, matching self-buffs like Berserk that apply
	 *  unconditionally on cast). */
	requiresDamagingHit?: boolean;
	/**
	 * Extra static gate evaluated once per resolution, not per placement -- e.g. Havoc's 2+
	 * Vestments pieces, or Gloves of Passage's item check. Absent means "always eligible" (every
	 * self-triggered ability buff so far has no gear gate).
	 *
	 * A compound condition (gear equipped AND a global unlock checkbox, e.g. Gloves of Passage's
	 * enhanced-via-account-unlock variant, following the same ModifierContext boolean-flag pattern
	 * as `ringOfVigourActive`/`furyOfTheSmallActive`) needs no new field: it's just a predicate
	 * that reads more than one ModifierContext property. Since the enhancement can improve one
	 * emitted buff without the other (Rend's "Enduring Ruin" self-buff and "Corrupted Wounds"
	 * enemy debuff independently), model base and enhanced as SEPARATE BuffEmission objects with
	 * mutually-exclusive gearConditions (base: item equipped AND NOT unlocked; enhanced: item
	 * equipped AND unlocked) rather than one emission whose numbers scale -- so an ability can
	 * have up to 4 emits entries for this one item (base/enhanced x Enduring Ruin/Corrupted
	 * Wounds), each independently swapped in or out.
	 */
	gearCondition?: (ctx: ModifierContext) => boolean;
	durationTicks: number;
	/**
	 * What happens if the trigger fires again while an instance from this SAME emission is still
	 * active. Defaults to 'restart' (every ordinary self-buff: recasting just begins a fresh
	 * window from the later cast, replacing the old one -- Berserk's own behavior).
	 *  - 'restart': end the old instance right now, start a brand new full-duration one.
	 *  - 'burst': end the old instance right now WITHOUT starting a new one, and apply
	 *    `reTriggerEffect` once instead (Havoc: re-triggering while active grants an instant
	 *    adrenaline burst and ends the regen window early, rather than stacking or restarting).
	 */
	reTriggerBehavior?: 'restart' | 'burst';
	/** Required when `reTriggerBehavior: 'burst'` -- the one-off effect applied at the moment of
	 *  the burst (e.g. Havoc's instant +20% adrenaline). Ignored otherwise. */
	reTriggerEffect?: NumericEffect & { resourceId: string };
	/**
	 * If set, the buff is also consumed early -- ended at that placement's tick, with `effect`
	 * applied to just that one placement -- the moment a placement matching `consumedBy` occurs
	 * while it's active. `durationTicks` still acts as the max lifetime/timeout if nothing
	 * consumes it first (Greater Fury/Chaos Roar: 25/12-tick timeout; Gloves of Passage's Enduring
	 * Ruin: 10-tick timeout). Absent means the buff only ever ends via its own durationTicks
	 * timeout or a 'restart'/'burst' re-trigger (Berserk, Havoc's steady state, Corrupted Wounds).
	 */
	consumedBy?: {
		/** Defaults to "any placement dealing damage" (abilityDealsDamage) -- the shape every
		 *  existing consume-on-next-hit buff (Greater Fury, Chaos Roar, Gloves of Passage) uses.
		 *  Override only for a consumption rule that isn't simply "the next damaging hit". */
		matches?: (ability: Ability) => boolean;
		/** The damage multiplier or resource effect applied to the ONE consuming placement, e.g.
		 *  Greater Fury's 1.5x crit, Chaos Roar's 1.75x, Gloves of Passage's +10% next attack. */
		effect: NumericEffect;
		/** Whether `effect` applies to every hit of a multi-hit consuming placement (Greater Fury:
		 *  the whole channel's pre-split total is boosted, per the wiki) or only the first landed
		 *  hit (Chaos Roar: "next STRIKE" -- a single hit, even out of a channel -- see
		 *  parseHitProfile.isBleed for the one exception: a genuine bleed's hits are all still that
		 *  one strike, so they all count). Defaults to 'all'. */
		appliesToHits?: 'all' | 'first';
	};
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
