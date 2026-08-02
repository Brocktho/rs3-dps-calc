# Long-term design: the resolution pipeline

Status: **design only — no implementation yet.** This document defines the target interfaces and
the invariants the whole application must satisfy, so that every future feature (new set effect,
new ability quirk, new toggle item) lands as *data* flowing through one pipeline rather than a new
bespoke resolver. It builds directly on:

- `ability-resolver-design.md` — Phases 1–2 established `Ability.resolve` for damage/hits/bleed
  (done) and cooldown (planned). This document is the end state those phases converge toward.
- The Modifier/Resource engine (`modifiers.ts`, `resources.ts`) — set effects and toggles become
  `Modifier`s exclusively; no new ad-hoc resolver functions.

Terminology note: the UI and this doc say "frame" and "tick" interchangeably; the engine's unit is
the game tick (`TICK_SECONDS = 0.6`). "Frame 0" below is the first tick of the timeline.

---

## 1. The pipeline, end to end

Every calculation the app performs is one deterministic pass through five stages. Each stage's
output is an immutable input to the next; nothing downstream may reach back and mutate an earlier
stage's output.

```
(1) Gear Tab            →  GearLoadout            (player's starting equipment)
(2) Monster selection   →  EnemyContext           (affinity, armour, defence, hp assumption)
(3) Global config       →  GlobalContext          (toggles/unlocks; FROZEN for the whole timeline)
(4) Timeline events     →  GearBuffer             (gear-as-a-function-of-tick + set-effect
                                                   modifier windows, revalidated on gear swap)
(5) Per-tick evaluation →  resolve(...)           (THE single resolution point for damage,
                                                   adrenaline, cooldown, hits — per placement,
                                                   per channel tick)
```

The core architectural rule: **stages 1–3 are computed once; stage 4 is recomputed only when a
gear-swap event is added/moved/removed; stage 5 is a pure function of the other four.** A change
to the Gear Tab invalidates everything; a change to a timeline gear swap invalidates only stage 4
onward; placing an ability invalidates only stage 5.

---

## 2. Stage 1 — GearLoadout (the Gear Tab)

The player's starting equipment. This is the *initial value* of the gear buffer, not a global
constant — mid-timeline swaps produce new loadouts derived from it (§5).

```ts
/** One complete equipment state. Immutable value object — a gear swap produces a NEW loadout,
 *  never mutates one, so loadouts can be shared by reference across gear-buffer segments and
 *  compared cheaply. */
interface GearLoadout {
	/** Slot → equipped item. Every slot is always present; empty slots are null so "what changed"
	 *  diffs never have to distinguish missing-key from unequipped. */
	slots: Record<EquipmentSlot, EquippedItem | null>;
}

type EquipmentSlot =
	| 'head' | 'body' | 'legs' | 'hands' | 'feet' | 'cape' | 'neck'
	| 'ring' | 'ring2' | 'mainHand' | 'offHand' | 'ammo' | 'pocket' | 'aura';

interface EquippedItem {
	name: string;
	/** Armour.setName when the item belongs to a set — the ONLY key set-effect counting uses. */
	setName: string | null;
	// stats (accuracy, armour, damage, ...) come from the existing JSON loaders by name.
}
```

`GearContext` (the derived view `resolve` sees — `isTwoHanded`, `hasOffHandWeapon`,
`equippedCapeName`, ...) is **computed from a `GearLoadout`**, never stored. Today it's built once
in the UI; under this design there is one derivation function and it is the only way to get one:

```ts
function deriveGearContext(loadout: GearLoadout): GearContext;
```

`GearContext` grows fields as abilities need them (per-slot names, set piece counts), but always
as pure derivations of the loadout. **Invariant: two equal loadouts derive equal contexts.**

---

## 3. Stage 2 — EnemyContext and the hit-chance pipeline

```ts
interface EnemyContext {
	/** The selected Boss/monster record: per-style affinities, armour, defence level, weakness. */
	monster: Boss;
	/** User-entered assumption (Punish gating). Static for the whole timeline for now — see
	 *  Open Questions for the live-HP-tracking future. */
	hpPercent: number;
}
```

Hit chance is per-gear-segment, not global — a mid-timeline weapon swap changes accuracy, so hit
chance must be a function of `(GearLoadout, EnemyContext, GlobalContext)`, evaluated once per gear
buffer segment (§5), not once per session.

The over-cap ordering the user specified is the load-bearing edge case, so the computation is
split into named steps that must run in exactly this order:

```ts
interface HitChanceBreakdown {
	/** Affinity * (accuracy / armourRating) — UNCAPPED. May exceed 100 (e.g. 115). */
	raw: number;
	/** Every pre-cap adjustment that applied, for provenance display. */
	adjustments: AppliedHitChanceAdjustment[];
	/** raw + Σ adjustments, still uncapped (115 − 10 = 105). */
	adjusted: number;
	/** clamp(adjusted, 0, 100). The only value damage math may consume. */
	final: number;
}

/** Armour/jewelry special effects that shift hit chance BEFORE the cap. Declared as data on the
 *  item (or as a Modifier with a new 'hitChance' aspect — see §6), never hardcoded in the
 *  formula. */
interface HitChanceAdjustment {
	source: ModifierSource;
	/** Additive percentage points applied pre-cap; negative for penalties. */
	amountPercent: number;
	isActive: (gear: GearContext, global: GlobalContext) => boolean;
}
```

**Invariants:**
- The cap is applied exactly once, last. No adjustment ever reads or writes the capped value.
- `raw` is preserved uncapped so a 115% raw − 10% penalty correctly lands at 100% final (not 90%).
- Recomputed per gear segment: a swap that changes accuracy or removes the penalty item yields a
  new `HitChanceBreakdown` for the following segment.

---

## 4. Stage 3 — GlobalContext (frozen for the whole timeline)

Everything configured outside the timeline that **cannot change during combat**: account unlocks
(`ringOfVigourActive`, `furyOfTheSmallActive`), prayer/toggle items from the config tab, combat
style. This is today's `ModifierContext` *minus* the gear-derived fields:

```ts
interface GlobalContext {
	combatStyle: CombatStyle | null;
	ringOfVigourActive: boolean;
	furyOfTheSmallActive: boolean;
	// ...future unlock/toggle booleans, same flat-flag pattern.
}
```

**The critical split:** today's `ModifierContext` mixes frozen globals with gear-derived state
(`setPieceCounts`, `hasMeleeWeaponEquipped`). Under the gear buffer those gear-derived fields are
**per-tick**, not global — so `ModifierContext` is redefined as a *composition* assembled per
tick, and the old monolith is retired:

```ts
/** What every predicate/modifier gate sees at a given tick. Assembled, never stored. */
interface TickContext {
	global: GlobalContext;              // identical object every tick — frozen at stage 3
	gear: GearContext;                  // from the gear buffer segment covering this tick
	setPieceCounts: Record<string, number>; // derived from that same segment's loadout
	hasMeleeWeaponEquipped: boolean;        // ditto
}
```

Existing predicates (`isActive(ctx)`, `gearCondition(ctx)`, `requiresContext(ctx)`) migrate to
`TickContext` mechanically — same fields, new grouping. **Invariant: nothing may cache a
`TickContext` across ticks; it is only valid for the tick it was assembled for.**

Frame 0 ("set the initial frame value") is not a special case: it is simply the tick-0
`TickContext`, assembled from the Gear Tab loadout (the gear buffer's first segment) plus the
frozen globals. Set effects active at tick 0 exist because the gear buffer's first segment
produces their modifier windows starting at tick 0 (§5) — not because of any separate
"initialization" code path.

---

## 5. Stage 4 — The GearBuffer

The single new stateful concept. Gear is the **only** thing that changes mid-timeline; everything
else (globals, enemy) is constant.

### 5.1 Representation: segments, not per-tick state

```ts
/** A gear-swap event placed on the timeline. Sits in the same placements list as abilities via a
 *  discriminated union, so ordering/serialization/undo are shared. */
interface GearSwapPlacement {
	kind: 'gearSwap';
	id: string;
	startTick: number;
	/** STORED as a delta: only the slots this swap explicitly changes. One placement can change
	 *  one slot or fifteen — a full melee→mage transition is still a single swap. Slots absent
	 *  from the delta inherit from whatever precedes this swap, which is what lets a Gear Tab
	 *  edit propagate forward through every swap that didn't touch that slot. */
	changes: Partial<Record<EquipmentSlot, EquippedItem | null>>;
}
```

**Editor UX vs storage (decided): the user edits a full loadout; the engine stores a diff.**
Selecting "gear swap" opens a complete copy of the loadout in effect at that tick (via `gearAt`),
every slot pre-filled — the user changes any/all slots in one editor and never assembles a delta
by hand. On save, the delta is computed as `diff(editedLoadout, inheritedLoadout)`: only slots
whose saved value differs from what they'd inherit are stored in `changes`.

Consequences of diffing at save time:
- A slot the user leaves untouched (or re-selects to its inherited value) stays out of the delta,
  so a later Gear Tab edit — or an earlier swap edit — flows through it automatically.
- A slot the user changed is pinned to their chosen item from that tick onward (until a later
  swap changes it again), even if upstream gear changes — which is the only reasonable reading of
  "the user explicitly picked this item here."
- Re-opening a swap's editor always shows `gearAt` of its own tick (inherited state + its own
  delta applied), so the editor stays truthful after upstream changes.
- Open UX question (not an engine one): whether the editor needs an explicit "pin without
  changing" affordance for a user who wants a slot to KEEP its current item even if the Gear Tab
  changes later. Deferred until real usage shows it's needed.

```ts
interface AbilityPlacement {
	kind: 'ability';        // today's TimelinePlacement, tagged
	id: string;
	abilityName: string;
	startTick: number;
}

type Placement = AbilityPlacement | GearSwapPlacement;

/** The gear buffer: gear as a step function of tick. Derived state — rebuilt in full by
 *  revalidation (§5.2); never incrementally patched. */
interface GearBuffer {
	segments: GearSegment[]; // sorted, contiguous, segment[0].startTick === 0
}

interface GearSegment {
	startTick: number;
	endTick: number;               // exclusive; last segment's = timeline length
	loadout: GearLoadout;          // Gear Tab loadout + all deltas up to here, folded in tick order
	gearContext: GearContext;      // derived once per segment
	setPieceCounts: Record<string, number>;
	hitChance: HitChanceBreakdown; // §3, recomputed per segment
}

function gearAt(buffer: GearBuffer, tick: number): GearSegment; // binary search
```

### 5.2 Revalidation: one pass per gear change

When any `GearSwapPlacement` is added, moved, or removed, the gear buffer is rebuilt **once**, in
one left-to-right pass — not simulated tick by tick:

1. Segment 0 is the Gear Tab loadout, from tick 0 to the first swap.
2. Fold each swap's `changes` delta in `startTick` order, each producing a new segment: the
   previous segment's loadout with the delta's slots replaced. (Two swaps on the same tick merge
   into one segment; later placement id wins per conflicting slot — deterministic, and the UI
   surfaces them as one combined swap.)
3. For each segment, derive `gearContext`, `setPieceCounts`, `hitChance`.
4. Diff each segment's `setPieceCounts`/item conditions against the previous segment's to emit
   **set-effect window boundaries** (§5.3).

Because swaps store deltas, **an upstream edit propagates through every downstream slot no swap
touched**: change your Gear Tab ring and every segment carries the new ring, except across a swap
whose delta pinned that slot. This is exactly the propagation the delta representation is chosen
for — the full-snapshot alternative was considered and rejected because it freezes every slot at
what the editor showed at save time, silently disconnecting later swaps from Gear Tab edits.

**Invariants:**
- Revalidation is pure: `(baseLoadout, swapPlacements, timelineLength) → GearBuffer`. Same inputs,
  same buffer. It never reads ability placements — gear does not depend on abilities.
- The swap takes effect **at the start of its tick**: an ability on the same tick resolves against
  the post-swap segment. (This is the one ordering rule for same-tick events; it is fixed here so
  no call site ever re-decides it.)
- Deleting a swap, editing the Gear Tab, or reordering swaps all go through the same rebuild —
  there is no incremental "undo one swap" path to get subtly wrong.

### 5.3 Set effects as indefinite modifier windows (the "inverse buff signal")

The user's requirement — set effects modeled via the Modifier system, active "indefinitely" until
a gear swap removes them — maps onto the existing `ResolvedBuff`-window machinery rather than a
new lifetime concept inside `Modifier`:

```ts
/** A window during which a set-effect (or item-effect) condition holds. Produced ONLY by gear
 *  buffer revalidation. Shape-compatible with ResolvedBuff so BuffWindowModifiers gate on it
 *  with zero engine changes. */
interface GearEffectWindow {
	/** e.g. "Vestments of havoc armour (2pc)" — the name BuffWindowModifier.buffAbilityName /
	 *  a new gearEffectName field matches on. */
	effectName: string;
	startTick: number; // segment where the condition became true
	endTick: number;   // segment where it became false, else timeline length ("indefinite")
	source: ModifierSource;
}
```

- "Indefinite" = `endTick === timelineLength`. There is no `Infinity` sentinel and no
  never-expiring modifier state to garbage-collect: every window is finite within the timeline,
  and "removed by a gear swap" is simply a window that closes at the swap segment's boundary.
- The "inverse buff signal to undo set effects" is **not an event that mutates state** — it is the
  window's `endTick`. Because revalidation rebuilds all windows from scratch, un-equipping 2pc
  Vestments at tick 40 just produces a `[0, 40)` window instead of a `[0, len)` window; nothing is
  "undone," the wrong state simply never exists. This is deliberate: an imperative
  apply/revert-signal design would have to keep apply and revert perfectly symmetric forever
  (re-equip, swap two set pieces on the same tick, swap that breaks one set while completing
  another); the rebuild design gets all of those correct for free.
- Re-equipping later produces a second disjoint window for the same `effectName` — already legal
  for `ResolvedBuff`s today.
- Threshold changes count as boundaries too: dropping 4pc → 3pc closes the 4pc window while the
  2pc/3pc windows stay open. Each threshold that has distinct behavior is its own `effectName`
  (e.g. "Vestments (2pc)", "Vestments (3pc)", "Vestments (4pc)"), so partial-set edge cases fall
  out of window arithmetic instead of special cases.

Each set effect's *behavior* is then declared exactly once, as ordinary `Modifier`s (usually
`BuffWindowModifier`-shaped, gated on the `GearEffectWindow` name) and/or `BuffEmission`
`gearCondition`s reading the per-tick `TickContext` — no new modifier kind. The existing
`PassiveModifier.isActive(ctx)` pattern keeps working because `ctx` is now per-tick (§4): a
passive gated on `setPieceCounts` automatically deactivates the tick a swap breaks the set.

**Edge cases this must survive (acceptance list for the revalidation implementation):**

| Case | Required outcome |
|---|---|
| Swap breaks set A and completes set B on the same tick | A's windows close and B's open at the same boundary; one segment diff handles both |
| Swap mid-channel changes `setPieceCounts` | Later channel ticks resolve under the new segment (§6); earlier ticks are untouched |
| Swap mid-buff (e.g. Berserk active) removes the set that *extended* that buff | The buff's ability-emitted window is NOT retroactively shortened — set effects that modified a buff at emission time stay applied (matches in-game snapshot behavior); only *ongoing* per-tick effects (regen, caps) stop. Emission-time vs ongoing is decided per effect in its Modifier data, not globally |
| Swap on tick 0 | Folds into the first segment; equivalent to editing the Gear Tab for that run |
| Two swaps on the same tick touching the same slot | Deterministic (later id's delta wins per slot); UI merges the display |
| Gear Tab edited after swaps exist | New value propagates through every segment whose swaps didn't pin that slot; pinned slots keep their delta value |
| Swap's delta becomes a no-op after upstream edit (delta sets slot to what it now inherits) | Segment diff is empty for that slot → no window boundary; the swap placement itself remains valid |
| Swap to the identical item | No segment diff → no window boundary → no spurious re-emission |
| Removing a weapon (empty mainHand) | `deriveGearContext` must produce a valid unarmed context, not throw |
| Swap lowers the adrenaline cap below current adrenaline | Adrenaline clamps to the new cap at the swap tick (§5.4) — the only swap side effect that exists |

### 5.4 Gear swaps are free — except cap clamping (decided)

Gear swaps have **no cost**: no GCD time, no adrenaline drain, no placement conflict. The single
side effect a swap can have is indirect, through resource caps:

- A resource's cap is already a modifier aspect (`resourceAspect: 'cap'` — Vestments of havoc
  4pc + melee weapon → max adrenaline 120). Caps are gated on per-tick state
  (`setPieceCounts`, `hasMeleeWeaponEquipped`), so a swap that breaks the set OR removes the last
  melee weapon deactivates the cap modifier from that segment onward, and the cap reverts to the
  base 100.
- **Clamp rule:** whenever the effective cap at a tick is lower than the current resource value,
  the value clamps down to the cap immediately, at that tick — a player at 115 adrenaline who
  swaps off a Vestments piece (or off melee) drops to 100 at the swap tick, before any ability on
  that tick resolves (swap-first rule, §5.2).
- This is **not** a `GearSwapPlacement` output and not special-cased to swaps: the clamp is a
  standing invariant of resource resolution ("value ≤ effective cap at every tick"), so the same
  rule also covers a cap-granting *buff* expiring mid-timeline, with no swap involved. The swap
  case is just the cap modifier deactivating at a segment boundary.
- Clamped adrenaline is lost, not suspended: re-equipping the set later raises the cap back to
  120 but does not restore the clamped-away amount.

---

## 6. Stage 5 — `resolve` as the sole resolution point

Phase 1/2 of `ability-resolver-design.md` made `resolve` optional and partial for
damage/hits/bleed/cooldown. The end state widens it to **everything behavioral** and makes the
engine's resolution functions the only readers:

```ts
interface ResolvedAbility {
	damagePercent: string | number;
	hitOffsets: number[];
	isBleed: boolean;
	/** WHEN each hit's damage is computed (timing rule 2 below):
	 *   - 'cast' (default): every hit — even ones landing ticks later, e.g. a delayed/staggered
	 *     ability — is computed under the buffs/gear active at the CAST tick. An instant-cast
	 *     ability whose hits apply later still benefits from the buffs it was cast under.
	 *   - 'perTick': each hit is computed under the buffs/gear active at ITS OWN landing tick —
	 *     channeled abilities, whose later ticks are genuinely re-evaluated in game.
	 *  Named as a timing semantic rather than `isChanneled` so a future non-channel ability that
	 *  recomputes on hit can opt in without pretending to be a channel. */
	damageTiming: 'cast' | 'perTick';
	cooldownTicks: number;
	/** Adrenaline generated (+) or required/spent (−) by this cast — replaces direct reads of the
	 *  static `adrenaline` field everywhere in resolveAdrenaline. */
	adrenaline: number;
	/** Buffs/debuffs this cast emits, replacing direct reads of the static `emits` field — so an
	 *  emission can itself be gear-dependent (igneous capes changing an Ultimate's emission). */
	emits: BuffEmission[];
}

interface AbilityResolveContext {
	gear: GearContext;      // from gearAt(buffer, tick) — NOT the tick-0 loadout
	enemy: EnemyContext;
	global: GlobalContext;  // frozen
	tick: TickContext;      // setPieceCounts etc. for this tick — assembled per §4
	/** Read-only view of timeline state at the tick being resolved — what resolve needs so that
	 *  timeline-dependent behavior (Overpower's 15-tick cooldown while Berserk is active) is
	 *  decided INSIDE resolve, not by an outside override layered on top. Deliberately narrow:
	 *  buff-window queries only, never the raw placements list, so resolve can't grow ad-hoc
	 *  dependencies on placement ordering. */
	timeline: TimelineView;
}

interface TimelineView {
	/** Is a buff/gear-effect window with this name active at the tick being resolved? Covers
	 *  ability buffs (Berserk) and GearEffectWindows (§5.3) uniformly. */
	isBuffActive(buffName: string): boolean;
}

// On Ability (unchanged shape, widened output):
resolve?: (input: AbilityResolveContext) => Partial<ResolvedAbility>;
```

The engine exposes exactly one entry point per aspect, and each follows the same three-step
fallback (established in Phase 1, now the law for all five fields):
`resolve` output → static field on the ability → legacy fallback chain (until fully migrated).

```ts
function resolveAbility(
	ability: Ability,
	buffer: GearBuffer,
	enemy: EnemyContext,
	global: GlobalContext,
	timeline: TimelineView, // buff/gear-effect windows already resolved for atTick
	atTick: number
): ResolvedAbility;
```

**Resolution-timing rules — the edge-case core of this design:**

1. **Cast-tick snapshot** for `adrenaline` (the cast's own cost/generation), `cooldownTicks`,
   `emits`, and `damageTiming` itself: resolved once, against the contexts at the placement's
   `startTick`, and never re-resolved. A gear swap two ticks into a channel does not
   retroactively change what the cast cost or what cooldown it started.
2. **Damage timing follows `damageTiming`** (not one blanket rule):
   - `'cast'` (the default, covering every non-channeled ability): every hit's damage is computed
     under the cast tick's gear segment and active buffs/modifiers, even for hits whose
     `hitOffsets` entry lands ticks later. A delayed or staggered ability keeps the boost from a
     buff it was cast under, even if that buff expires before the hit lands. Bleeds are just
     `'cast'`-timed multi-hit abilities — their in-game damage-locks-at-cast behavior is exactly
     this rule, no separate mechanism.
   - `'perTick'` (channeled abilities): each hit is computed under the gear segment and modifier
     set active at its own landing tick (`startTick + offset`) — a buff gained or lost
     mid-channel changes only the remaining ticks.
3. **`hitOffsets` themselves are cast-tick-resolved** (rule 1): the number and spacing of a
   channel's hits is fixed when the channel starts, even though each hit's damage re-resolves
   under `'perTick'` (rule 2). A mid-channel swap to the igneous cape does not add hits to an
   in-flight Ultimate.
4. **Timeline-dependent behavior is decided inside `resolve`, via `TimelineView`** — there is no
   outside override layer. Overpower's Berserk-conditional cooldown is
   `resolve: ({ timeline }) => ({ cooldownTicks: timeline.isBuffActive('Berserk') ? 15 : 100 })`,
   returned by resolve itself rather than reported statically and corrected afterward.
   `CONDITIONAL_COOLDOWNS` is therefore a legacy mechanism slated for deletion, superseding the
   Phase-2 stance in `ability-resolver-design.md` that kept it outside resolve — `TimelineView`
   is the input-widening that stance said would be needed. `effectiveCooldownTicks` survives only
   as the fallback-chain walker (resolve output → static field → legacy), not as an override.

**Purity invariant:** `resolve` is a pure function; it may not read module state, the raw
placements list, or clocks. Everything it can vary on is in `AbilityResolveContext` — including
`TimelineView`, which is itself derived state passed in, not reached for. The practical
consequence: results are cacheable per `(ability, segment, enemy, global, active-buff-set)`, and
the engine must resolve buff windows for a tick *before* resolving abilities cast on it (already
the evaluation order below — windows at step 2–3, placements at step 4). Note the one-way
dependency this imposes: buff windows may not depend on `resolve` outputs that depend on buff
windows at the same tick (a cooldown can read Berserk's window; an emission may not conditionally
exist based on another emission resolved the same tick — if that case ever arises it needs an
explicit two-pass design, not an ad-hoc ordering hack).

### Per-tick evaluation order

Fixed, engine-wide, so no effect ordering is ever ambiguous:

```
for each tick t:
  1. Gear segment boundary?  → TickContext for t uses the new segment (swap-first rule, §5.2)
  2. Gear-effect windows opening/closing at t take effect (they are just windows — nothing runs)
  3. Resource cap clamp (§5.4): each resource value clamps to its effective cap under t's
     modifier set — before any placement on t resolves
  4. Placements starting at t: resolveAbility (cast-tick aspects), emissions fire
  5. Hits landing at t (from this and earlier placements): damage computed per rule 2 —
     'cast'-timed hits use their placement's cast-tick contexts, 'perTick' hits use t's —
     consumedBy checks, per-hit resource bonuses
  6. Ambient per-tick modifier income (perTickIncome), respecting its +1-tick activation offset
```

### Kill-point marker (decided: no live HP tracking)

Live per-tick enemy HP tracking is explicitly **out of scope** — `EnemyContext.hpPercent` stays a
static user-entered assumption (Punish's gate). The one HP-derived output the app does provide is
a read-only marker derived *after* damage resolution, downstream of the whole pipeline:

```ts
/** First tick where cumulative expected damage meets/exceeds the monster's HP, or null if the
 *  rotation never gets there. Pure post-processing over the existing cumulativeDamage series
 *  plus Boss hitpoints — reads nothing back into resolution. */
interface KillPoint {
	tick: number;
	/** Damage overshoot at that tick, for display ("dead at 42s, 3,120 over"). */
	overkill: number;
}

function findKillPoint(cumulative: number[], monsterHp: number): KillPoint | null;
```

Rendered as a vertical line marker on the timeline/chart ("boss dead here"). **Invariant: the
kill point is display-only.** It must not feed back into resolution — abilities placed after it
still resolve normally (the user may be planning a longer fight, or the expected-damage model may
overestimate), and Punish's `hpPercent` gate does not auto-update from it. If live HP tracking is
ever built, it replaces this marker wholesale rather than growing out of it.

---

## 7. Migration plan (sequenced, each step independently shippable)

Ordered so every step keeps the current app fully working — same strategy as Phase 1's
"old fields stay live until nothing references them."

1. **Context split** — introduce `GlobalContext`/`TickContext`; adapt `ModifierContext` consumers
   mechanically. No behavior change; pure refactor with existing tests as the harness.
   **DONE** (2026-08-02): `formulas/context.ts` holds `GearContext`/`GlobalContext`/`TickContext`
   (+ neutral defaults); the `ModifierContext` monolith is deleted, every predicate
   (`isActive`, `requiresContext`, `gearCondition`, `Ability.resolve`) takes `TickContext`.
2. **GearLoadout + deriveGearContext** — formalize the Gear Tab's output; `GearContext` becomes
   derived-only. Still a single loadout for the whole timeline (buffer with one segment).
   **DONE** (2026-08-02): `formulas/gear.ts` (types + `deriveGearContext`/`deriveSetPieceCounts`/
   `deriveHasMeleeWeaponEquipped`); `+page.svelte`'s `loadoutForSetup` is the single
   Setup→loadout builder, and all gear-derived views go through the derivation functions.
   Note: a shield and an off-hand weapon share the one `offHand` slot (they're mutually
   exclusive in the UI); `hasOffHandWeapon` is true only when the off-hand item is a known
   weapon, and `equippedCapeName` is now consistently the raw cape slot name for the active
   setup and overlays alike.
3. **Hit-chance pipeline** — `HitChanceBreakdown` with the raw → adjust → cap ordering and the
   first real `HitChanceAdjustment` (the armour/jewelry −% effect). Provenance shown in UI.
   **DONE** (2026-08-02), with one deviation: no real adjustment item's data exists yet, so
   `HIT_CHANCE_ADJUSTMENTS` ships empty and the ordering invariants (uncapped raw absorbing a
   pre-cap penalty, single final clamp, inactive-adjustment filtering) are proven by synthetic
   adjustments in `hitChance.spec.ts` — same prove-the-engine-first pattern as `HAVOC_EMISSION`.
   MonsterPanel renders `.final` plus a provenance line whenever an adjustment applies; the
   first real item is a data-only addition to the registry.
4. **GearBuffer + GearSwapPlacement** — the `Placement` union, segment rebuild, `gearAt`. UI for
   placing swaps on the timeline. At first, *nothing reads segments but hit chance* — proving the
   buffer before wiring set effects to it.
5. **GearEffectWindows** — revalidation emits set-effect windows; migrate Vestments of havoc (the
   richest existing set) from its bespoke resolvers onto windows + existing Modifiers. The
   §5.3 acceptance table becomes this step's test list.
6. **`resolve` Phase 2 (cooldown) + `TimelineView`** — the engine plumbing from
   `ability-resolver-design.md`, amended: `AbilityResolveContext` gains `timeline`, and
   Overpower's Berserk cooldown migrates INTO its `resolve` (rule 4), retiring
   `CONDITIONAL_COOLDOWNS` — this supersedes that doc's keep-it-outside stance.
7. **`resolve` Phase 3 (adrenaline, emits)** — widen `ResolvedAbility`; `resolveAdrenaline` and
   emission collection go through `resolveAbility`. Static `adrenaline`/`emits` fields become the
   fallback tier, per the standard three-step chain.
8. **`damageTiming`** — `damageByTick` honors the cast-vs-perTick split (rule 2): channels'
   hits evaluate against their own tick's segment/modifiers; everything else snapshots the cast
   tick. Until step 4 lands, the gear half is a no-op (one segment) but the buff-window half is
   immediately meaningful for channels.
9. **Final deletion pass** — legacy fallbacks (`damageVariants` remnants, description regexes,
   monolithic `ModifierContext`) removed only when zero abilities depend on them.

Steps 1–3 are low-risk refactors; step 4 is the first new user-facing feature; steps 5–8 each
retire a bespoke mechanism. No step requires the ~214 static abilities to change at all.

The kill-point marker (§6) is independent of every step above — it only consumes the existing
`cumulativeDamage` series and `Boss` hitpoints, so it can ship at any time, including first.

---

## 8. Open questions (decide before the relevant step, not now)

1. **Emission-time vs ongoing classification (§5.3 table row 3)** — needs a per-effect audit of
   the existing set effects when step 5 lands; the mechanism supports both, but each effect's
   correct in-game behavior must be verified against the wiki (via the MediaWiki raw-wikitext
   workflow) case by case.
2. **Same-tick swap+ability UX** — the engine rule is fixed (swap first), but the timeline UI
   needs an affordance making that ordering visible so users aren't surprised.
