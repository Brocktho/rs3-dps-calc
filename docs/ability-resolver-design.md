# Ability resolver redesign

## Problem

`Ability` fields today are a mix of two genuinely different things:

- **Identity** — never changes regardless of gear, enemy, or global state: `name`, `style`,
  `requiredSkill`, `requiredLevel`, `type`.
- **Behavior** — `adrenaline`, `damagePercent`, `target`, `cooldownText`, hit count/timing — which
  *can* depend on equipped gear, the targeted enemy, or global unlocks, but today are stored as
  static values with the gear-dependent cases bolted on as ad-hoc parallel dictionaries
  (`damageVariants`, `hitCountVariants`) keyed by fragile prose-matching strings
  (`resolveGearVariant`'s `k.includes('two-handed')`, `k.startsWith('igneous kal-')`, ...).

This was already stretched further than it should go this session: `damagePercent` first grew a
function form for enemy-HP gating (Punish), then a second, competing "gear-aware" function form
was proposed for the igneous-cape abilities, and a third competing "hit count" field was about to
be added on top of the already-existing `HitProfile`/`damagesOnTick` fields — three different
mechanisms all partially answering "how much damage / how many hits does this attack do," each
disagreeing with the others about which one wins.

The actual fix is structural, not another field: identity fields stay static; every behavior field
becomes the output of **one resolver function per ability**, with a plain static value being the
degenerate case of that same function (a function that ignores its input and returns a constant).

## Goals

- One thing to read per ability to know what it actually does under the player's current
  gear/enemy/global-unlock state — not four separate dictionaries that have to be manually kept in
  sync (`damageVariants` + `hitCountVariants` + `damagesOnTick`'s gear-`Record` form + `HitProfile`).
- Remove the fragile prose-string gear matching (`resolveGearVariant`) entirely, in favor of real
  `GearContext` property checks (`gear.equippedCapeName === 'Igneous Kal-Zuk'`).
- No regression for the ~214 abilities that have no gear/enemy dependency at all — they must stay
  exactly as cheap and simple to write as a static value, with zero required boilerplate.
- Land incrementally. This is NOT a rewrite-everything-at-once change.

## Resolved output shape (Phase 1 scope)

Per the user's direction: don't keep a `'simultaneous' | 'staggered' | 'channel'` union at all --
pre-compute every hit's tick offset into one flat array, always. A channel's evenly-spaced hits, a
staggered ability like Ricochet, and a plain single hit are all just different arrays of the exact
same shape -- the interval/spacing math only matters at the moment the array is built (inside
`resolve`, or inside the one shared helper below for the common "N hits every K ticks" case), never
afterward. This also means `numberOfHits` isn't its own field -- it's just `hitOffsets.length`.

```ts
interface ResolvedAbility {
	damagePercent: string | number;
	/** Tick OFFSET from the placement's own startTick for every hit, one entry per hit, e.g.:
	 *    - a plain single hit: [0]
	 *    - Ricochet (3 hits, staggered): [0, 1, 1]
	 *    - Slaughter (6 hits every 3 ticks): [0, 3, 6, 9, 12, 15]
	 *  Replaces today's `HitProfile` (channel case) AND `damagesOnTick` entirely -- one array
	 *  answers both "how many hits" (`.length`) and "when" (the values themselves), instead of
	 *  three fields that could disagree with each other.
	 */
	hitOffsets: number[];
	/** True for an unconditional bleed/DoT (Dismember, Slaughter, Massacre): a genuinely different
	 *  behavioral flag from the timing shape above, unrelated to hitOffsets -- it controls whether
	 *  a later GCD placement interrupts the remaining hits (resolveChannels), not how the hits are
	 *  spaced. Kept as its own field rather than encoded into hitOffsets somehow. Defaults to
	 *  false/BLEED_ABILITY_NAMES membership for abilities with no `resolve`. */
	isBleed: boolean;
}

type AbilityResolveContext = {
	ctx: ModifierContext; // player global state: setPieceCounts, ringOfVigourActive, ...
	gear: GearContext; // isTwoHanded, hasOffHandWeapon, equippedCapeName
	enemy: Enemy; // { hpPercent } -- user-entered assumption, not live-tracked
};

// On Ability:
resolve?: (input: AbilityResolveContext) => Partial<ResolvedAbility>;

/** Shared helper for the common "N hits every K ticks" case, so a `resolve` function doesn't
 *  hand-write the arithmetic -- e.g. Slaughter: evenlySpacedHitOffsets(6, 3) -> [0,3,6,9,12,15]. */
function evenlySpacedHitOffsets(hits: number, intervalTicks: number): number[] {
	return Array.from({ length: hits }, (_, i) => i * intervalTicks);
}
```

`resolve` is **optional** and returns a **Partial** — an ability that only needs to override
`damagePercent` (Punish) returns `{ damagePercent: ... }` and the engine falls back to that
ability's own static `damagePercent`/`hitOffsets`/`isBleed` for everything it didn't override. An
ability with NO gear/enemy dependency (~214 of 222) sets no `resolve` at all and nothing changes
for it — this is the "static value is the degenerate case" requirement.

Every currently-verified channel/bleed ability (Dismember, Slaughter, Massacre, Assault, Rapid
Fire, Greater Flurry, ...) gets its `hitProfile`/`damagesOnTick` fields replaced by a plain,
pre-computed `hitOffsets: number[]` static array (e.g. Slaughter: `hitOffsets: [0, 3, 6, 9, 12, 15]`)
-- computed once by hand (or via `evenlySpacedHitOffsets` at data-definition time) rather than at
resolve time, since none of those abilities' timing depends on gear/enemy/context at all. Only
abilities whose hit count/timing genuinely varies by context (Adaptive Strike, the igneous-cape
Ultimates) need an actual `resolve` function for this field.

Deliberately **out of scope for Phase 1**: `adrenaline`, `cooldownText`, `target` becoming resolver
outputs too. Real cases exist (Overpower's cooldown drops to 15 ticks while Berserk is active,
already modeled by the separate `CONDITIONAL_COOLDOWNS` mechanism; Havoc's adrenaline burst is
already modeled by `BuffEmission.reTriggerEffect`) but folding those into this same resolver is a
bigger, separate migration of already-working mechanisms, and doing it in the same pass as the
damage/hits work risks breaking both. Phase 1 proves the resolver shape on the narrowest real case
first.

## Migration list (Phase 1)

8 abilities get a `resolve` function; every other ability is untouched:

| Ability | Depends on | Notes |
|---|---|---|
| Punish | `enemy.hpPercent` | Already identified: 120% normally, 300% below 50% HP (2.5x). Existing stored string `'120% (300%...)'` was silently wrong — `parseDamageMultiplier`'s regex averaged all three percents in the string (120/300/50 → 156.67%, unconditionally), not applied conditionally. `resolve: ({ enemy }) => ({ damagePercent: enemy.hpPercent < 50 ? 300 : 120 })`. |
| Adaptive Strike | `gear` (dual wield vs. 2h/main-hand-only) | Also fixes a real pre-existing bug: `hitCountVariants` was `null`, so `hitCountFor` fell back to a bare "2 hits." regex match and returned 2 for EVERY weapon setup, when 2h/main-hand-only is actually 1 hit. `resolve` returns `{ damagePercent, hitOffsets: [0, 0] or [0] }` keyed on `gear.hasOffHandWeapon`/`gear.isTwoHanded`. |
| Overpower | `gear.equippedCapeName` (Igneous Kal-Ket/Kal-Zuk) | 545% base 1 hit `[0]` / 620% 2 hits `[0, 0]` with cape (simultaneous, per the wiki -- not staggered like Ricochet). |
| Deadshot | `gear.equippedCapeName` (Igneous Kal-Xil/Kal-Zuk) | 460% base 4 hits / 520% 8 hits with cape -- both simultaneous (`hitOffsets` all-zero arrays of length 4/8), per how this ability already resolves today (`hitTicksForPlacement` treats it as a same-tick multi-hit, not a channel). |
| Omnipower | `gear.equippedCapeName` (Igneous Kal-Mej/Kal-Zuk) | 460% base 1 hit / 540% 4 hits with cape. |
| Death Skulls | `gear.equippedCapeName` (Igneous Kal-Mor/Kal-Zuk) | 250%-750% base 4 bounces / 250%-1000% 6 bounces with cape — damage is itself a range even per-variant; kept as the existing range-string convention. |
| Asphyxiate | `ctx.setPieceCounts` (4+ Tumeken's resplendence) | First real use of a full-set gate outside Vestments of Havoc. Tumeken's resplendence doesn't exist in `armour.ts` yet — the `ctx.setPieceCounts["Tumeken's resplendence equipment"]` key will simply read as `0`/absent until that armour is added, an identical "no-op until the data exists" situation as Gloves of Passage and Havoc earlier this session, not a new gap. Its own hit shape (channel, 7 ticks) is unaffected by the set bonus, so only `damagePercent` needs `resolve` here -- `hitOffsets` stays a static field. |
| Ranged | — | NOT migrated. Its "variant" (`Any: '100%'`, `'Dark bow or Gloomfire bow': '100%'`) has identical values on both branches — dead scraped data, not a real gear dependency. Collapse to a plain `damagePercent: '100%'`, no `resolve` needed. |

`damageVariants`, `hitCountVariants`, and `damagesOnTick`'s `Record<string, number[]>` gear-keyed
form are deleted from the `Ability` interface once these 8 are migrated (215/217 of the 222 entries
already have them `null` — those `: null` lines are deleted via a scripted pass, not by hand,
since it's pure mechanical churn with no behavior change).

`resolveGearVariant` (the fragile prose-string matcher) is deleted entirely — every one of its
call sites will be gone.

## Engine changes

- `resolveDamagePercent(ability, gear, enemy, ctx)` — checks `ability.resolve` first; if present
  and its result has `damagePercent`, use that (still normalized through the existing
  string/number handling). Otherwise falls through to today's static
  `damagePercent`/`damageVariants` handling (Punish's simpler `(enemy) => ...` form from earlier
  this session gets folded into `resolve` too, for one consistent mechanism instead of two).
- A new `resolveHitOffsets(ability, gear, enemy, ctx)` replaces `parseHitProfile` +
  `resolveDamagesOnTick` + `hitCountFor`'s variant-lookup branch entirely: checks `ability.resolve`
  first for `hitOffsets`, else falls back to the ability's own static `hitOffsets` field, else (for
  an ability that hasn't been migrated to the new field at all yet) the existing description-regex
  fallback. `hitCountFor` becomes simply `resolveHitOffsets(...).length` -- no separate hit-count
  concept.
- `resolveIsBleed(ability)` similarly checks `ability.resolve`'s `isBleed` first, else the
  ability's own static `isBleed` field, else `BLEED_ABILITY_NAMES.has(ability.name)` (today's
  hand-curated set, kept as the fallback for every not-yet-migrated bleed).
- `damageByTick`/`resolveChannels` gain a `ctx: ModifierContext` parameter (they don't receive one
  today) so `resolve` can be called with everything it needs. Every existing optional trailing
  parameter stays optional/defaulted, so non-Phase-1 callers/tests are unaffected.

## What this explicitly does NOT change in Phase 1

- `adrenaline`, `cooldownText`, `target` stay static fields — no resolver involvement yet.
- `BuffEmission`/`resolveEmittedBuffs` (the buff-emission engine from earlier this session) —
  unrelated system, untouched.
- Any of the other 214 abilities' data or tests.

## Migration strategy: old fields stay live until nothing references them

Per the user's direction, this is a gradual, whole-codebase migration, not a one-pass rewrite --
same pattern already established this session for `verified`/description-regex fallback:

- `HitProfile` (`ability.hitProfile`), `damagesOnTick`, `damageVariants`, and `hitCountVariants`
  are **not removed** in this phase. They keep working exactly as today for every ability that
  hasn't been migrated yet.
- The new resolution functions (`resolveHitOffsets`, the widened `resolveDamagePercent`) each
  check, in order: (1) `ability.resolve`'s relevant output, if present and the ability declares
  one; (2) a new static `hitOffsets`/`isBleed` field directly on `Ability`, if set; (3) today's
  existing fallback chain (`hitProfile` field → description regex → `HIT_COUNT_OVERRIDES` /
  `damageVariants` → `resolveGearVariant`), completely unchanged. Nothing currently working stops
  working.
- Each ability gets migrated to the new fields **independently, at its own pace** -- there is no
  requirement to migrate a whole batch together. The 8 abilities in the Phase 1 list are simply the
  first ones being migrated in this pass because they're the ones that actually need `resolve`
  (gear/enemy-dependent); an ability with static timing (Assault, Rapid Fire, Slaughter, ...) can
  be migrated to a static `hitOffsets` field independently, any time, with zero urgency.
- **Only once every ability in the data has been migrated** do `HitProfile`, `damagesOnTick`,
  `damageVariants`, `hitCountVariants`, `resolveGearVariant`, `parseHitProfile`'s regex body, and
  `hitCountFor`'s regex/override fallback actually get deleted, as one final cleanup pass -- not as
  part of this or any single migration step.

## Open question for review before implementation starts

Confirm the 8-ability migration list above is complete/correct before implementation starts.
