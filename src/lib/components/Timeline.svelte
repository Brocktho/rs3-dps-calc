<script lang="ts">
	import {
		abilityTickSpan,
		BLOODLUST_BASE_CAP,
		buffBaseEndTick,
		canPlaceAbility,
		colorForAbility,
		cooldownZonesFor,
		cumulativeDamage,
		damageByTick,
		findSwapTarget,
		gcdPlacementAt,
		groupBuffExtensions,
		insertAbilityAtAnchor,
		isOffGcdAbility,
		nextOpenTick,
		packIntoLanes,
		requiredTimelineLength,
		resolveAdrenaline,
		resolveAllBuffs,
		resolveBloodlust,
		resolveChannels,
		respectsCooldown,
		runningAverageDps,
		slidingWindowDpm,
		TICK_SECONDS,
		type Ability,
		type CombatStyle,
		type GearContext,
		type TimelinePlacement
	} from '$lib';
	import TimelineChart from './TimelineChart.svelte';

	interface Props {
		abilities: Ability[];
		combatStyle: CombatStyle | null;
		adTotal: number;
		startingAdrenaline: number;
		hasRingOfVigour: boolean;
		hasFuryOfTheSmall: boolean;
		gearContext: GearContext;
		/** How many pieces of each armour set (keyed by Armour.setName) are currently equipped --
		 *  see ModifierContext.setPieceCounts. Drives set-effect Modifiers like Vestments of
		 *  havoc's Herald of Chaos (2pc/3pc/4pc thresholds). */
		setPieceCounts: Record<string, number>;
		hasMeleeWeaponEquipped: boolean;
		placements: TimelinePlacement[];
		styleFilterEnabled: boolean;
		timelineLength: number;
		/** Player's hit chance (0-100) against the selected target, keyed by combat style -- see
		 *  formulas/hitChance.ts and damageByTick's `hitChanceByStyle` param. Optional so Timeline
		 *  still works standalone/in tests with no target selected (defaults to 100% everywhere). */
		hitChanceByStyle?: Partial<Record<CombatStyle, number>>;
		/** Every setup's own damage series (including this one), for the multi-setup overlay chart --
		 *  see `+page.svelte`'s `setupSeries`. Optional so Timeline can still be used/tested standalone
		 *  with just its own single-setup chart. */
		overlaySeries?: {
			id: string;
			label: string;
			color: string;
			tickDamage: number[];
			cumulative: number[];
			dpm: number[];
			adrenaline: number[];
		}[];
	}

	let {
		abilities,
		combatStyle,
		adTotal,
		startingAdrenaline,
		hasRingOfVigour,
		hasFuryOfTheSmall,
		gearContext,
		setPieceCounts,
		hasMeleeWeaponEquipped,
		placements = $bindable(),
		styleFilterEnabled = $bindable(),
		timelineLength = $bindable(),
		overlaySeries,
		hitChanceByStyle = {}
	}: Props = $props();

	let paletteSearch: string = $state('');
	let invalidDropTick: number | null = $state(null);

	// Ghost preview: dataTransfer.getData() is only readable on the actual `drop` event in most
	// browsers, not during `dragover` -- so the ability/placement being dragged is tracked here
	// directly (set at dragstart, cleared at dragend) purely to compute where the ghost preview
	// should render and whether the current hover position is valid. dataTransfer is still used
	// separately for the actual drop payload.
	let draggingAbility: Ability | null = $state(null);
	let draggingPlacementId: string | null = $state(null);
	// The dragged placement's own start tick, if dragging an existing placement (not a fresh
	// palette ability). Used to suppress the ghost while it's still hovering its own current
	// slot -- otherwise the ghost box paints directly on top of the ability's own icon the
	// instant the drag starts (before the pointer has moved anywhere), which reads as the icon
	// getting shoved underneath something rather than staying put until you actually drag it.
	let draggingOriginTick: number | null = $state(null);
	let gridEl: HTMLDivElement | undefined = $state();

	// What the current drag would do if dropped right now: place/swap at a tick, or -- when
	// hovering near the left/right edge of an existing GCD ability's icon -- insert before/after
	// it, shifting everything from that point on later to make room.
	type DragIntent =
		| { kind: 'place'; tick: number; cooldownConflict: boolean }
		| { kind: 'insert'; anchorId: string; side: 'before' | 'after'; tick: number };
	let hoverIntent: DragIntent | null = $state(null);

	const filteredAbilities = $derived.by(() => {
		let list = abilities;
		if (styleFilterEnabled && combatStyle) {
			list = list.filter((a) => a.style === combatStyle);
		}
		const needle = paletteSearch.trim().toLowerCase();
		if (needle) {
			list = list.filter(
				(a) =>
					a.name.toLowerCase().includes(needle) ||
					(a.weapons?.some((w) => w.toLowerCase().includes(needle)) ?? false)
			);
		}
		return list;
	});

	function abilityByName(name: string): Ability | undefined {
		return abilities.find((a) => a.name === name);
	}

	function weaponChipIconPath(ability: Ability): string | null {
		if (!ability.weapons || ability.weapons.length === 0) return null;
		const slug = ability.weapons[0]
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
		return `/weapon-icons/${slug}.png`;
	}

	function placeAbility(ability: Ability) {
		const tick = nextOpenTick(
			ability,
			placements,
			abilities,
			timelineLength,
			allBuffs.endlessAssaultBleedPlacementIds
		);
		if (tick === null) return;
		placements = [
			...placements,
			{ id: crypto.randomUUID(), abilityName: ability.name, startTick: tick }
		];
	}

	function removePlacement(id: string) {
		placements = placements.filter((p) => p.id !== id);
	}

	function flashInvalid(tick: number) {
		invalidDropTick = tick;
		setTimeout(() => {
			if (invalidDropTick === tick) invalidDropTick = null;
		}, 150);
	}

	// Setting draggingAbility/draggingPlacementId triggers reactive DOM insertions elsewhere in this
	// component (most notably cooldownZones, which mounts a NEW .cooldown-zone band the instant a
	// placement with an existing same-name cooldown starts dragging). Doing that DOM mutation
	// synchronously inside the dragstart handler itself is exactly the pattern that makes Chromium/
	// Firefox silently abort an in-progress native drag (an immediate dragend, no visible ghost) --
	// confirmed directly: a first-of-its-kind placement (nothing to show a cooldown zone against, so
	// no DOM mutation happens) always dragged fine, while a second occurrence of the same ability
	// (which DOES have a cooldown zone to render) never did, and pausing on a dragstart breakpoint
	// (which delays the reactive update past the browser's drag-initialization window) let the drag
	// succeed and the cooldown zone become visible. A microtask still runs before the browser
	// repaints/yields, so it isn't late enough -- setTimeout(0) genuinely defers to a later task,
	// after the browser has committed to the drag. dataTransfer calls must stay synchronous --
	// browsers require setData/effectAllowed during the dragstart event itself.
	function onPaletteDragStart(e: DragEvent, ability: Ability) {
		e.dataTransfer?.setData('text/x-timeline-new-ability', ability.name);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
		setTimeout(() => {
			draggingAbility = ability;
			draggingPlacementId = null;
			draggingOriginTick = null;
		}, 0);
	}

	function onPlacementDragStart(e: DragEvent, placement: TimelinePlacement) {
		e.dataTransfer?.setData('text/x-timeline-move-placement', placement.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		setTimeout(() => {
			draggingAbility = abilityByName(placement.abilityName) ?? null;
			draggingPlacementId = placement.id;
			draggingOriginTick = placement.startTick;
		}, 0);
	}

	function onDragEnd() {
		draggingAbility = null;
		draggingPlacementId = null;
		draggingOriginTick = null;
		hoverIntent = null;
	}

	// Computes what the current drag would do from the cursor's raw pixel position, rather than
	// relying on which per-cell element happens to be under the pointer -- a placed GCD ability's
	// icon spans 3 whole columns, so a per-cell dragover handler always reports that placement's
	// fixed start tick no matter where in its width the cursor actually is. Pixel math tracks the
	// true cursor position continuously, including while hovering over wide icons, and also lets
	// us detect the left/right "insert" edge zones of an existing GCD ability's icon.
	const INSERT_EDGE_FRACTION = 0.25;

	// A 'place' intent always tracks the exact tick the cursor is over -- the ability must be
	// draggable freely, with no live snapping fighting the pointer while the drag is still in
	// progress. `cooldownConflict` just flags whether dropping HERE would collide with another
	// placement of this same ability, for the ghost's red styling; what actually happens to that
	// conflict (the drop gets pushed past an EARLIER use's cooldown, or a LATER use gets cleared
	// out of the way -- see handlePlaceDrop) is resolved only once, at drop time.
	function placeIntent(tick: number): DragIntent {
		const cooldownConflict = draggingAbility
			? !respectsCooldown(
					draggingAbility,
					tick,
					placements,
					abilities,
					timelineLength,
					draggingPlacementId ?? undefined
				)
			: false;
		return { kind: 'place', tick, cooldownConflict };
	}

	function computeDragIntent(e: DragEvent): DragIntent | null {
		if (!gridEl || timelineLength === 0) return null;
		const rect = gridEl.getBoundingClientRect();
		const colWidth = rect.width / timelineLength;
		const xPx = e.clientX - rect.left;
		const tick = Math.max(0, Math.min(timelineLength - 1, Math.floor(xPx / colWidth)));

		if (!draggingAbility || isOffGcdAbility(draggingAbility)) {
			return placeIntent(tick);
		}

		const covering = gcdPlacementAt(tick, placements, abilities);
		if (!covering || covering.id === draggingPlacementId) {
			return placeIntent(tick);
		}
		const coveringAbility = abilityByName(covering.abilityName);
		if (!coveringAbility) return placeIntent(tick);

		const span = abilityTickSpan(coveringAbility);
		const fraction = (xPx - covering.startTick * colWidth) / (span * colWidth);
		if (fraction < INSERT_EDGE_FRACTION) {
			return { kind: 'insert', anchorId: covering.id, side: 'before', tick: covering.startTick };
		}
		if (fraction > 1 - INSERT_EDGE_FRACTION) {
			return {
				kind: 'insert',
				anchorId: covering.id,
				side: 'after',
				tick: covering.startTick + span
			};
		}
		return placeIntent(covering.startTick);
	}

	function onGridDragOver(e: DragEvent) {
		e.preventDefault();
		hoverIntent = computeDragIntent(e);
	}

	function onGridDrop(e: DragEvent) {
		e.preventDefault();
		const intent = computeDragIntent(e);
		if (intent) handleDrop(e, intent);
	}

	function handleDrop(e: DragEvent, intent: DragIntent) {
		if (intent.kind === 'insert') {
			handleInsertDrop(e, intent);
		} else {
			handlePlaceDrop(e, intent.tick);
		}
	}

	function handleInsertDrop(
		e: DragEvent,
		intent: { anchorId: string; side: 'before' | 'after'; tick: number }
	) {
		const movingId = e.dataTransfer?.getData('text/x-timeline-move-placement');
		const newAbilityName = e.dataTransfer?.getData('text/x-timeline-new-ability');
		const ability = movingId
			? abilityByName(placements.find((p) => p.id === movingId)?.abilityName ?? '')
			: abilityByName(newAbilityName ?? '');
		if (!ability) return;

		const placementId = movingId || crypto.randomUUID();
		const result = insertAbilityAtAnchor(
			placements,
			abilities,
			ability,
			intent.anchorId,
			intent.side,
			placementId
		);
		if (!result) {
			flashInvalid(intent.tick);
			return;
		}
		// Same policy as a plain place/move: honor exactly where this was asked to go (right
		// before/after the anchor) with no cooldown-driven relocation or clearing of any other
		// placement -- a resulting cooldown violation is simply flagged (see
		// cooldownViolationPlacementIds), not resolved by removing something else.
		placements = result;
		const required = requiredTimelineLength(placements, abilities);
		if (required > timelineLength) timelineLength = required;
	}

	// Placement lands EXACTLY where dropped -- no cooldown-driven snapping or relocation, and no
	// clearing of any other same-name placement. A drop is only ever rejected for a genuine
	// GCD-collision with another placement (in which case an exact-single-conflict swap is offered
	// instead); a cooldown violation against another use of the SAME ability is allowed through and
	// simply flagged afterward (see cooldownViolationPlacementIds) with a warning icon, rather than
	// blocking the move or silently relocating/deleting anything. This intentionally permits
	// building an "invalid" rotation -- the timeline no longer refuses to represent one.
	function handlePlaceDrop(e: DragEvent, tick: number) {
		const movingId = e.dataTransfer?.getData('text/x-timeline-move-placement');
		if (movingId) {
			const placement = placements.find((p) => p.id === movingId);
			const ability = placement ? abilityByName(placement.abilityName) : undefined;
			if (!placement || !ability) return;
			if (canPlaceAbility(ability, tick, placements, abilities, timelineLength, movingId)) {
				placements = placements.map((p) => (p.id === movingId ? { ...p, startTick: tick } : p));
				return;
			}
			const swapTarget = findSwapTarget(movingId, tick, placements, abilities, timelineLength);
			if (swapTarget) {
				// A swap exchanges each ability's own ORIGINAL start tick, not the resolved drop
				// tick -- see findSwapTarget's doc comment for why using the raw drop tick here
				// could leave the two new positions overlapping each other.
				const movingOriginalTick = placement.startTick;
				const targetOriginalTick = swapTarget.startTick;
				placements = placements.map((p) => {
					if (p.id === movingId) return { ...p, startTick: targetOriginalTick };
					if (p.id === swapTarget.id) return { ...p, startTick: movingOriginalTick };
					return p;
				});
				return;
			}
			flashInvalid(tick);
			return;
		}

		const newAbilityName = e.dataTransfer?.getData('text/x-timeline-new-ability');
		if (!newAbilityName) return;
		const ability = abilityByName(newAbilityName);
		if (!ability) return;
		if (!canPlaceAbility(ability, tick, placements, abilities, timelineLength)) {
			flashInvalid(tick);
			return;
		}
		placements = [
			...placements,
			{ id: crypto.randomUUID(), abilityName: ability.name, startTick: tick }
		];
	}

	// GCD row: one cell per tick, either an open drop-target or (at a GCD placement's start
	// tick) the placement's icon spanning its full 3-tick width. Ticks covered by another
	// placement's span are skipped entirely -- the spanning icon itself covers that grid area.
	interface GcdCell {
		tick: number;
		kind: 'empty' | 'placement' | 'covered';
		placement?: TimelinePlacement;
		span?: number;
	}

	const gcdRow = $derived.by(() => {
		const cells: GcdCell[] = [];
		const coveredUntil = new Array(timelineLength).fill(false);
		for (const p of placements) {
			const ability = abilityByName(p.abilityName);
			if (!ability || isOffGcdAbility(ability)) continue;
			const span = abilityTickSpan(ability);
			for (let t = p.startTick + 1; t < p.startTick + span && t < timelineLength; t++) {
				coveredUntil[t] = true;
			}
		}
		for (let tick = 0; tick < timelineLength; tick++) {
			if (coveredUntil[tick]) {
				cells.push({ tick, kind: 'covered' });
				continue;
			}
			const placement = placements.find((p) => {
				if (p.startTick !== tick) return false;
				const ability = abilityByName(p.abilityName);
				return ability && !isOffGcdAbility(ability);
			});
			if (placement) {
				const ability = abilityByName(placement.abilityName)!;
				cells.push({ tick, kind: 'placement', placement, span: abilityTickSpan(ability) });
			} else {
				cells.push({ tick, kind: 'empty' });
			}
		}
		return cells;
	});

	// Off-GCD row: one flex cell per tick, holding zero or more stacked off-GCD placements.
	const offGcdRow = $derived.by(() => {
		const byTick: TimelinePlacement[][] = Array.from({ length: timelineLength }, () => []);
		for (const p of placements) {
			const ability = abilityByName(p.abilityName);
			if (ability && isOffGcdAbility(ability) && p.startTick < timelineLength) {
				byTick[p.startTick].push(p);
			}
		}
		return byTick;
	});

	// Single shared resolution of every buff/status effect this app models (ordinary self-buffs,
	// Vestments of havoc's set effects, Greater Fury's crit-on-next-hit, Greater Barge's Endless
	// Assault bleed conversion) -- computed once and reused by the buff lane, the channel lane
	// (bleed exemption), and the damage engine (crit multiplier), rather than re-resolving it
	// independently in each derived value below.
	const allBuffs = $derived(
		resolveAllBuffs(placements, abilities, timelineLength, setPieceCounts, gearContext)
	);

	// Buff lane: each self-buff placement packed into the minimum number of stacked rows needed
	// (a compact Gantt -- only buffs whose active windows actually overlap get separate rows).
	const packedBuffs = $derived(packIntoLanes(allBuffs.buffs));
	const buffLaneCount = $derived(packedBuffs.reduce((max, b) => Math.max(max, b.lane + 1), 0));
	const buffLanes = $derived(
		Array.from({ length: buffLaneCount }, (_, lane) => packedBuffs.filter((b) => b.lane === lane))
	);

	// Channel/DoT lane: same lane-packing, over each channelled placement's (possibly
	// interruption-truncated) hit window. Endless Assault-converted placements are exempted from
	// truncation (see resolveChannels' bleedPlacementIds) and flagged `isBleed` for styling.
	const packedChannels = $derived(
		packIntoLanes(
			resolveChannels(
				placements,
				abilities,
				timelineLength,
				allBuffs.endlessAssaultBleedPlacementIds
			).map((c) => ({
				...c,
				endTick: c.barEndTick
			}))
		)
	);
	const channelLaneCount = $derived(
		packedChannels.reduce((max, c) => Math.max(max, c.lane + 1), 0)
	);
	const channelLanes = $derived(
		Array.from({ length: channelLaneCount }, (_, lane) =>
			packedChannels.filter((c) => c.lane === lane)
		)
	);

	// Adrenaline gauge: always on (not drag-gated, unlike the cooldown zone bands) -- simulates the
	// gauge across the whole timeline given the starting value and each placement's own generate/
	// spend, including Imbue: Shadows' Ranged per-hit bonus.
	const adrenalineStates = $derived(
		resolveAdrenaline(
			placements,
			abilities,
			combatStyle,
			startingAdrenaline,
			timelineLength,
			hasRingOfVigour,
			hasFuryOfTheSmall,
			setPieceCounts,
			hasMeleeWeaponEquipped,
			gearContext
		)
	);
	const currentAdrenaline = $derived(
		adrenalineStates.length > 0
			? adrenalineStates[adrenalineStates.length - 1].value
			: startingAdrenaline
	);
	// Bloodlust is melee-only -- resolveBloodlust already no-ops non-melee placements, but the lane
	// itself is only worth showing at all when melee is the active combat style.
	const showBloodlust = $derived(combatStyle === 'melee');
	// resolveBloodlust now returns the resource engine's own per-tick cap alongside the value
	// (Berserk raising it to 8 is a Modifier the engine already resolves), so there's no need to
	// separately re-derive Berserk's buff windows here just to know the ceiling.
	const bloodlustStates = $derived(
		showBloodlust ? resolveBloodlust(placements, abilities, timelineLength, setPieceCounts) : []
	);

	// Cooldown zones: while dragging an ability, a static red band over every tick range where that
	// SAME ability can't be reused yet (one band per existing placement of it) -- shown alongside
	// the ghost as a reference for *why* a spot is blocked, distinct from the ghost which shows
	// *where it will actually land* once forward-snapped past these zones.
	const cooldownZones = $derived.by(() => {
		if (!draggingAbility) return [];
		return cooldownZonesFor(
			draggingAbility.name,
			placements,
			abilities,
			timelineLength,
			draggingPlacementId ?? undefined
		);
	});
	const cooldownZonesAreOffGcd = $derived(
		draggingAbility ? isOffGcdAbility(draggingAbility) : false
	);

	// Ghost preview: while dragging (palette or an existing placement), highlight where it would
	// land at the currently-hovered tick, colored by whether the drop would succeed -- either as
	// a normal placement or (for an existing GCD placement dragged onto another) a swap. Only
	// shown for a 'place' intent -- hovering an insert edge zone shows the insert indicator
	// instead (see insertAnchorId/insertSide below).
	const ghostSpan = $derived(draggingAbility ? abilityTickSpan(draggingAbility) : 0);
	const ghostIsOffGcd = $derived(draggingAbility ? isOffGcdAbility(draggingAbility) : false);
	const placeGhostTick = $derived(hoverIntent?.kind === 'place' ? hoverIntent.tick : null);
	const showGhost = $derived(
		draggingAbility !== null && placeGhostTick !== null && placeGhostTick !== draggingOriginTick
	);
	// Dropping here will collide with another placement of this same ability's cooldown -- the
	// ghost still shows exactly where the cursor is (no relocation), just flagged so the user
	// knows that conflicting placement will be cleared rather than the drop being rejected.
	const ghostCooldownConflict = $derived(
		hoverIntent?.kind === 'place' && hoverIntent.cooldownConflict === true
	);
	const ghostValid = $derived.by(() => {
		if (placeGhostTick === null || !draggingAbility) return false;
		if (ghostIsOffGcd) return placeGhostTick >= 0 && placeGhostTick < timelineLength;
		if (
			canPlaceAbility(
				draggingAbility,
				placeGhostTick,
				placements,
				abilities,
				timelineLength,
				draggingPlacementId ?? undefined
			)
		) {
			return true;
		}
		if (!draggingPlacementId) return false;
		return (
			findSwapTarget(draggingPlacementId, placeGhostTick, placements, abilities, timelineLength) !==
			null
		);
	});

	// Insert indicator: shown at the edge of the anchor ability's own icon while hovering its
	// left/right "insert" zone -- see computeDragIntent.
	const insertAnchorId = $derived(hoverIntent?.kind === 'insert' ? hoverIntent.anchorId : null);
	const insertSide = $derived(hoverIntent?.kind === 'insert' ? hoverIntent.side : null);

	// Purely informational -- flags a placed ability whose tick didn't have enough banked
	// adrenaline for its cost, without affecting placement/dragging in any way (see
	// resolveAdrenaline's doc comment).
	const insufficientAdrenalinePlacementIds = $derived.by(() => {
		const ids = new Set<string>();
		for (const p of placements) {
			if (p.startTick < 0 || p.startTick >= timelineLength) continue;
			if (adrenalineStates[p.startTick]?.insufficientForCost) ids.add(p.id);
		}
		return ids;
	});

	// Purely informational, like insufficientAdrenalinePlacementIds above -- flags a placement that
	// violates its own ability's cooldown against another use of the same ability, WITHOUT ever
	// blocking or relocating the placement itself. Dragging/moving/inserting an ability now always
	// lands exactly where it's dropped (see handlePlaceDrop/handleInsertDrop); an invalid-cooldown
	// rotation is something the user can deliberately build, just flagged with a warning icon rather
	// than silently snapped, blocked, or resolved by clearing a different placement.
	const cooldownViolationPlacementIds = $derived.by(() => {
		const ids = new Set<string>();
		for (const p of placements) {
			const ability = abilityByName(p.abilityName);
			if (!ability) continue;
			if (!respectsCooldown(ability, p.startTick, placements, abilities, timelineLength, p.id)) {
				ids.add(p.id);
			}
		}
		return ids;
	});

	const gearForDamage = $derived(gearContext);

	const berserkBuffs = $derived(allBuffs.buffs.filter((b) => b.abilityName === 'Berserk'));
	const searingWindsBuffs = $derived(allBuffs.buffs.filter((b) => b.abilityName === 'Galeshot'));
	const deathsSwiftnessBuffs = $derived(
		allBuffs.buffs.filter(
			(b) => b.abilityName === "Death's Swiftness" || b.abilityName === "Greater Death's Swiftness"
		)
	);

	const tickDamage = $derived(
		damageByTick(
			placements,
			abilities,
			adTotal,
			gearForDamage,
			timelineLength,
			allBuffs.greaterFuryCritPlacementIds,
			allBuffs.endlessAssaultBleedPlacementIds,
			allBuffs.chaosRoarBonusPlacementIds,
			berserkBuffs,
			searingWindsBuffs,
			deathsSwiftnessBuffs,
			hitChanceByStyle
		)
	);
	const cumulative = $derived(cumulativeDamage(tickDamage));
	const avgDps = $derived(runningAverageDps(tickDamage));
	const dpm = $derived(slidingWindowDpm(tickDamage));
	const totalDamage = $derived(cumulative[cumulative.length - 1] ?? 0);
	const overallAvgDps = $derived(avgDps[avgDps.length - 1] ?? 0);

	const tickIndices = $derived(Array.from({ length: timelineLength }, (_, i) => i));

	function extendTimeline() {
		timelineLength += 50;
	}

	function clearTimeline() {
		placements = [];
	}

	// Which of the 3 charts to show below the timeline -- all visible by default (matches prior
	// behavior). All three showing at once pushes the chart block far down the page, making it
	// bothersome to scroll past when you only care about one or two of them.
	let showCumulativeChart = $state(true);
	let showDpmChart = $state(true);
	let showAdrenalineChart = $state(true);
</script>

<div class="timeline-builder">
	<div class="timeline-header">
		<h2>Rotation Timeline</h2>
		<div class="timeline-summary">
			<span>Total damage: <strong>{totalDamage.toLocaleString()}</strong></span>
			<span>Avg DPS: <strong>{overallAvgDps.toFixed(0)}</strong></span>
			<span>Adrenaline: <strong>{Math.round(currentAdrenaline)}%</strong></span>
		</div>
		<div class="chart-toggles">
			<label class="chart-toggle">
				<input type="checkbox" bind:checked={showCumulativeChart} />
				Cumulative damage
			</label>
			<label class="chart-toggle">
				<input type="checkbox" bind:checked={showDpmChart} />
				DPM
			</label>
			<label class="chart-toggle">
				<input type="checkbox" bind:checked={showAdrenalineChart} />
				Adrenaline
			</label>
		</div>
	</div>

	<div class="palette">
		<div class="palette-controls">
			<input
				type="text"
				class="palette-search"
				placeholder="Search abilities..."
				bind:value={paletteSearch}
			/>
			<label class="palette-filter-toggle">
				<input type="checkbox" bind:checked={styleFilterEnabled} />
				Filter to equipped style
			</label>
		</div>
		<div class="palette-grid">
			{#each filteredAbilities as ability (ability.name)}
				<button
					type="button"
					class="palette-icon"
					class:off-gcd={isOffGcdAbility(ability)}
					title="{ability.name}{isOffGcdAbility(ability) ? ' (off-GCD)' : ''}"
					draggable="true"
					ondragstart={(e) => onPaletteDragStart(e, ability)}
					ondragend={onDragEnd}
					onclick={() => placeAbility(ability)}
				>
					<img src={ability.iconPath} alt={ability.name} width="28" height="28" />
					{#if weaponChipIconPath(ability)}
						<img
							class="weapon-chip"
							src={weaponChipIconPath(ability)}
							alt=""
							width="14"
							height="14"
						/>
					{/if}
				</button>
			{/each}
			{#if filteredAbilities.length === 0}
				<p class="palette-empty">No abilities match.</p>
			{/if}
		</div>
	</div>

	<div class="timeline-toolbar">
		<button type="button" onclick={extendTimeline}>+50 ticks (+30s)</button>
		<button type="button" onclick={clearTimeline}>Clear</button>
		<span class="timeline-length"
			>{timelineLength} ticks ({(timelineLength * TICK_SECONDS).toFixed(1)}s)</span
		>
	</div>

	<div class="timeline-scroll">
		<div
			class="timeline-grid"
			bind:this={gridEl}
			style:grid-template-columns="repeat({timelineLength}, 1.75rem)"
			ondragover={onGridDragOver}
			ondrop={onGridDrop}
		>
			<div class="timeline-ruler" style:grid-column="1 / -1">
				{#each tickIndices as tick (tick)}
					{#if tick % 5 === 0}
						<span class="ruler-label" style:grid-column={tick + 1}>
							{(tick * TICK_SECONDS).toFixed(1)}s
						</span>
					{/if}
				{/each}
			</div>

			<div class="timeline-row resource-row adrenaline-row" style:grid-column="1 / -1">
				{#each tickIndices as tick (tick)}
					<div
						class="resource-bar-cell"
						style:grid-column={tick + 1}
						title="Adrenaline: {Math.round(adrenalineStates[tick]?.value ?? 0)}%"
					>
						<div
							class="resource-bar-fill adrenaline-fill"
							style:height="{adrenalineStates[tick]?.value ?? 0}%"
						></div>
					</div>
				{/each}
			</div>

			{#if showBloodlust}
				<div class="timeline-row resource-row bloodlust-row" style:grid-column="1 / -1">
					{#each tickIndices as tick (tick)}
						{@const state = bloodlustStates[tick]}
						{@const cap = state?.cap ?? BLOODLUST_BASE_CAP}
						<div
							class="resource-bar-cell"
							style:grid-column={tick + 1}
							title="Bloodlust: {state?.value ?? 0}/{cap}"
						>
							<div
								class="resource-bar-fill bloodlust-fill"
								class:empowered={(state?.value ?? 0) >= BLOODLUST_BASE_CAP}
								style:height="{((state?.value ?? 0) / cap) * 100}%"
							></div>
						</div>
					{/each}
				</div>
			{/if}

			{#each buffLanes as lane, laneIndex (laneIndex)}
				<div class="timeline-row buff-row" style:grid-column="1 / -1">
					{#each lane as buff (buff.placementId)}
						{@const barSpan = buff.endTick - buff.startTick}
						{@const extensionGroups = groupBuffExtensions(buff.extensions, buffBaseEndTick(buff))}
						<div
							class="lane-box buff-box"
							style:grid-column="{buff.startTick + 1} / span {barSpan}"
							style:background-color={colorForAbility(buff.abilityName)}
							title="{buff.abilityName} (ticks {buff.startTick}-{buff.endTick - 1})"
						>
							{buff.abilityName}
							{#each extensionGroups as group (group.startTick)}
								<span
									class="buff-extension-region"
									style:left="{((group.startTick - buff.startTick) / barSpan) * 100}%"
									style:width="{((group.endTick - group.startTick) / barSpan) * 100}%"
									title="{group.sourceAbilityName} extended {buff.abilityName} by
										{group.totalExtendTicks} {group.totalExtendTicks === 1 ? 'tick' : 'ticks'}
										{group.eventCount > 1 ? `(${group.eventCount} hits)` : ''} -- now ticks
										{group.startTick}-{group.endTick - 1}"
								>
									{#if group.eventCount > 1}
										<span class="buff-extension-label">+{group.totalExtendTicks}</span>
									{/if}
								</span>
							{/each}
						</div>
					{/each}
				</div>
			{/each}

			{#each channelLanes as lane, laneIndex (laneIndex)}
				<div class="timeline-row channel-row" style:grid-column="1 / -1">
					{#each lane as channel (channel.placementId)}
						<div
							class="lane-box channel-box"
							class:bleed-box={channel.isBleed}
							style:grid-column="{channel.startTick + 1} / span {channel.barEndTick -
								channel.startTick}"
							style:border-color={colorForAbility(channel.abilityName)}
							title="{channel.abilityName} (ticks {channel.startTick}-{channel.barEndTick - 1}){channel.isBleed
								? ' -- converted to damage over time by Greater Barge, cannot be interrupted'
								: ''}"
						>
							<span class="channel-label"
								>{channel.abilityName}{channel.isBleed ? ' (DoT)' : ''}</span
							>
							{#each channel.hitTicks as hitTick (hitTick)}
								<span
									class="channel-tick"
									style:left="{((hitTick - channel.startTick) /
										(channel.barEndTick - channel.startTick)) *
										100}%"
								></span>
							{/each}
						</div>
					{/each}
				</div>
			{/each}

			<div class="timeline-row gcd-row" style:grid-column="1 / -1">
				{#each gcdRow as cell (cell.tick)}
					{#if cell.kind === 'empty'}
						<div
							class="tick-cell"
							class:invalid={invalidDropTick === cell.tick}
							style:grid-column={cell.tick + 1}
						></div>
					{:else if cell.kind === 'placement' && cell.placement}
						{@const ability = abilityByName(cell.placement.abilityName)}
						{#if ability}
							<button
								type="button"
								class="placed-icon gcd-icon"
								title={ability.name}
								style:grid-column="{cell.tick + 1} / span {cell.span}"
								draggable="true"
								ondragstart={(e) => onPlacementDragStart(e, cell.placement!)}
								ondragend={onDragEnd}
								onclick={() => removePlacement(cell.placement!.id)}
							>
								<img src={ability.iconPath} alt={ability.name} width="24" height="24" />
								{#if weaponChipIconPath(ability)}
									<img
										class="weapon-chip"
										src={weaponChipIconPath(ability)}
										alt=""
										width="12"
										height="12"
									/>
								{/if}
								{#if insertAnchorId === cell.placement!.id}
									<span
										class="insert-indicator"
										class:right={insertSide === 'after'}
										aria-hidden="true"
									>
										{insertSide === 'after' ? '▸' : '◂'}
									</span>
								{/if}
								{#if insufficientAdrenalinePlacementIds.has(cell.placement!.id)}
									<span
										class="adrenaline-warning"
										title="Not enough adrenaline banked at this point"
										aria-hidden="true">!</span
									>
								{/if}
								{#if cooldownViolationPlacementIds.has(cell.placement!.id)}
									<span
										class="cooldown-warning"
										title="This is not a valid placement for this ability due to cooldown"
										aria-hidden="true">▲</span
									>
								{/if}
								{#if allBuffs.greaterFuryCritPlacementIds.has(cell.placement!.id)}
									<span
										class="crit-marker"
										title="Consumed Greater Fury: guaranteed critical strike (1.5x damage)"
										aria-hidden="true">✦</span
									>
								{/if}
								{#if allBuffs.chaosRoarBonusPlacementIds.has(cell.placement!.id)}
									<span
										class="chaos-roar-marker"
										class:shifted={allBuffs.greaterFuryCritPlacementIds.has(cell.placement!.id)}
										title="Consumed Chaos Roar: empowered strike (1.75x base damage on the first hit)"
										aria-hidden="true">⚔</span
									>
								{/if}
							</button>
						{/if}
					{/if}
				{/each}
				{#if !cooldownZonesAreOffGcd}
					{#each cooldownZones as zone (`${zone.startTick}-${zone.endTick}`)}
						<div
							class="cooldown-zone"
							style:grid-column="{zone.startTick + 1} / span {zone.endTick - zone.startTick}"
							style:grid-row="1"
							aria-hidden="true"
						></div>
					{/each}
				{/if}
				{#if showGhost && !ghostIsOffGcd && placeGhostTick !== null}
					<div
						class="ghost-box"
						class:invalid={!ghostValid}
						class:cooldown-locked={ghostCooldownConflict}
						style:grid-column="{placeGhostTick + 1} / span {ghostSpan}"
						style:grid-row="1"
						aria-hidden="true"
					></div>
				{/if}
			</div>

			<div class="timeline-row off-gcd-row" style:grid-column="1 / -1">
				{#each offGcdRow as stack, tick (tick)}
					<div
						class="tick-cell off-gcd-cell"
						class:invalid={invalidDropTick === tick}
						style:grid-column={tick + 1}
					>
						{#each stack as placement (placement.id)}
							{@const ability = abilityByName(placement.abilityName)}
							{#if ability}
								<button
									type="button"
									class="placed-icon off-gcd-icon"
									title={ability.name}
									draggable="true"
									ondragstart={(e) => onPlacementDragStart(e, placement)}
									ondragend={onDragEnd}
									onclick={() => removePlacement(placement.id)}
								>
									<img src={ability.iconPath} alt={ability.name} width="18" height="18" />
									{#if weaponChipIconPath(ability)}
										<img
											class="weapon-chip off-gcd-chip"
											src={weaponChipIconPath(ability)}
											alt=""
											width="10"
											height="10"
										/>
									{/if}
									{#if insufficientAdrenalinePlacementIds.has(placement.id)}
										<span
											class="adrenaline-warning off-gcd-warning"
											title="Not enough adrenaline banked at this point"
											aria-hidden="true">!</span
										>
									{/if}
									{#if cooldownViolationPlacementIds.has(placement.id)}
										<span
											class="cooldown-warning off-gcd-warning"
											title="This is not a valid placement for this ability due to cooldown"
											aria-hidden="true">▲</span
										>
									{/if}
								</button>
							{/if}
						{/each}
					</div>
				{/each}
				{#if cooldownZonesAreOffGcd}
					{#each cooldownZones as zone (`${zone.startTick}-${zone.endTick}`)}
						<div
							class="cooldown-zone off-gcd-cooldown-zone"
							style:grid-column="{zone.startTick + 1} / span {zone.endTick - zone.startTick}"
							style:grid-row="1"
							aria-hidden="true"
						></div>
					{/each}
				{/if}
				{#if showGhost && ghostIsOffGcd && placeGhostTick !== null}
					<div
						class="ghost-box off-gcd-ghost"
						class:invalid={!ghostValid}
						class:cooldown-locked={ghostCooldownConflict}
						style:grid-column="{placeGhostTick + 1} / span 1"
						style:grid-row="1"
						aria-hidden="true"
					></div>
				{/if}
			</div>

			<div class="timeline-row chart-row" style:grid-column="1 / -1">
				<TimelineChart
					damageByTick={tickDamage}
					{cumulative}
					{dpm}
					adrenaline={adrenalineStates.map((s) => s.value)}
					{timelineLength}
					{overlaySeries}
					showCumulative={showCumulativeChart}
					showDpm={showDpmChart}
					showAdrenaline={showAdrenalineChart}
				/>
			</div>
		</div>
	</div>
</div>

<style>
	.timeline-builder {
		border: 2px solid #5a4a2c;
		border-radius: 6px;
		background: linear-gradient(180deg, #241d14 0%, #1a140d 100%);
		box-shadow:
			0 0 0 1px #0a0704 inset,
			0 4px 12px rgba(0, 0, 0, 0.5);
		padding: 1.25rem;
	}

	.timeline-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.timeline-header h2 {
		margin: 0;
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #d8b566;
	}

	.timeline-summary {
		display: flex;
		gap: 1.25rem;
		font-size: 0.9rem;
		color: #cbb98e;
	}

	.timeline-summary strong {
		color: #f4d78c;
	}

	.chart-toggles {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		width: 100%;
	}

	.chart-toggle {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: #cbb98e;
	}

	.palette {
		margin-bottom: 1rem;
	}

	.palette-controls {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.6rem;
	}

	.palette-search {
		font-size: 0.9rem;
		padding: 0.4rem 0.5rem;
		background: #100c08;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		color: #e8dcc4;
		flex: 1;
		min-width: 12rem;
		max-width: 20rem;
	}

	.palette-filter-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: #cbb98e;
	}

	.palette-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(2.4rem, 1fr));
		gap: 0.4rem;
		max-height: 12rem;
		overflow-y: auto;
		padding: 0.5rem;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		background: #100c08;
	}

	.palette-empty {
		grid-column: 1 / -1;
		color: #6b5d42;
		font-style: italic;
		margin: 0;
	}

	.palette-icon {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		border: 1px solid #3a2f1c;
		border-radius: 4px;
		background: radial-gradient(circle at 50% 40%, #241d14 0%, #150f0a 100%);
		cursor: grab;
	}

	.palette-icon:hover {
		border-color: #d97757;
	}

	.palette-icon.off-gcd {
		border-color: #4a7a5c;
	}

	.timeline-toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.timeline-toolbar button {
		font: inherit;
		font-weight: 600;
		padding: 0.35rem 0.7rem;
		background: #2e2517;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		color: #f4d78c;
		cursor: pointer;
	}

	.timeline-toolbar button:hover {
		background: #3a2f1c;
	}

	.timeline-length {
		font-size: 0.8rem;
		color: #a89468;
	}

	.timeline-scroll {
		overflow-x: auto;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		background: #100c08;
		padding: 0.5rem 0.5rem 0.75rem;
	}

	.timeline-grid {
		display: grid;
		grid-auto-rows: min-content;
		row-gap: 0.35rem;
		width: max-content;
	}

	.timeline-ruler {
		display: grid;
		grid-template-columns: subgrid;
		height: 1rem;
	}

	.ruler-label {
		font-size: 0.65rem;
		color: #8a7a5c;
		white-space: nowrap;
	}

	.timeline-row {
		display: grid;
		grid-template-columns: subgrid;
	}

	.buff-row,
	.channel-row {
		height: 1.4rem;
		position: relative;
	}

	.chart-row {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid #3a2f1c;
	}

	/* Always-on resource lanes (adrenaline gauge, Bloodlust stacks) -- one thin bar-fill cell per
	   tick, height proportional to the resource's value at that tick relative to its current cap. */
	.resource-row {
		height: 0.85rem;
	}

	.resource-bar-cell {
		display: flex;
		align-items: flex-end;
		height: 100%;
	}

	.resource-bar-fill {
		width: 100%;
		border-radius: 1px;
		min-height: 1px;
	}

	.adrenaline-fill {
		background: linear-gradient(180deg, #f4d78c 0%, #d8b566 100%);
	}

	.bloodlust-fill {
		background: linear-gradient(180deg, #9a9a9a 0%, #6b6b6b 100%);
	}

	.bloodlust-fill.empowered {
		background: linear-gradient(180deg, #e14b5f 0%, #a83240 100%);
	}

	.lane-box {
		display: flex;
		align-items: center;
		border-radius: 3px;
		font-size: 0.65rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 0 0.3rem;
		position: relative;
	}

	.buff-box {
		color: #14100c;
		font-weight: 600;
	}

	.channel-box {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid;
		color: #cbb98e;
	}

	.bleed-box {
		background: rgba(139, 0, 0, 0.12);
		border-style: dashed;
	}

	.channel-label {
		position: relative;
		z-index: 1;
	}

	.channel-tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: #f4d78c;
	}

	/* Highlights the tick range a buff's duration was extended over, so the bar visibly shows
	   WHY it's wider rather than just appearing to grow -- a translucent overlay plus a
	   hoverable tooltip naming the source ability (e.g. "Rapid Fire extended Galeshot by 8
	   ticks (8 hits)"). Consecutive same-source extension events (per groupBuffExtensions,
	   e.g. all 8 of Rapid Fire's individual +1-tick hits) are combined into ONE region rather
	   than one marker per event, since visually they're a single continuous "this ability is
	   extending the buff" occurrence, not 8 unrelated ones. */
	.buff-extension-region {
		position: absolute;
		top: 0;
		bottom: 0;
		background: rgba(255, 255, 255, 0.35);
		border-left: 1px solid rgba(20, 16, 12, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: help;
	}

	.buff-extension-label {
		font-size: 0.6rem;
		font-weight: 700;
		color: #14100c;
		text-shadow: 0 0 2px rgba(255, 255, 255, 0.6);
	}

	.off-gcd-row {
		height: 1.6rem;
	}

	.gcd-row {
		height: 2.4rem;
	}

	.tick-cell {
		border: 1px solid #2a2115;
		border-radius: 3px;
		background: #1a140d;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
	}

	.off-gcd-cell {
		height: 1.6rem;
	}

	.gcd-row .tick-cell {
		height: 2.4rem;
	}

	.tick-cell.invalid {
		border-color: #d97757;
		background: rgba(217, 119, 87, 0.25);
	}

	/* Live drop preview: sits on top of the real tick-cells/icons in the same grid row (rendered
	   after them in DOM order so it paints above) but never intercepts pointer/drag events
	   itself, so dragover/drop keep landing on the real cell underneath as the user drags. */
	.ghost-box {
		height: 2.4rem;
		border: 2px dashed #6fbf6f;
		border-radius: 3px;
		background: rgba(111, 191, 111, 0.2);
		pointer-events: none;
	}

	.ghost-box.invalid {
		border-color: #d97757;
		background: rgba(217, 119, 87, 0.2);
	}

	/* Distinct from .invalid (a rejected GCD-collision drop): this ghost position IS where the
	   drop will actually land -- it's just been forced forward past a cooldown-blocked zone, so it
	   gets a solid red fill instead of the invalid style's dashed orange to read as "forced", not
	   "rejected". */
	.ghost-box.cooldown-locked {
		border-color: #e14b5f;
		border-style: solid;
		background: rgba(225, 75, 95, 0.3);
	}

	.off-gcd-ghost {
		height: 1.6rem;
	}

	/* Static reference band(s) shown while dragging an ability, marking every stretch where that
	   SAME ability can't be reused yet due to its own cooldown -- one band per existing placement
	   of it. Sits in the same row/columns the ghost does, but doesn't move with the cursor. */
	.cooldown-zone {
		height: 2.4rem;
		border-radius: 3px;
		background: repeating-linear-gradient(
			45deg,
			rgba(225, 75, 95, 0.22),
			rgba(225, 75, 95, 0.22) 6px,
			rgba(225, 75, 95, 0.1) 6px,
			rgba(225, 75, 95, 0.1) 12px
		);
		border: 1px solid rgba(225, 75, 95, 0.5);
		pointer-events: none;
	}

	.off-gcd-cooldown-zone {
		height: 1.6rem;
	}

	.placed-icon {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		width: 100%;
		padding: 0;
		border: 1px solid #7a6534;
		border-radius: 3px;
		background: radial-gradient(circle at 50% 40%, #2e2517 0%, #1a140d 100%);
		cursor: pointer;
	}

	/* Shown on a placed GCD ability's icon while a drag is hovering its left/right edge zone,
	   indicating a drop there will insert the dragged ability before/after it (shifting
	   everything from that point on later) rather than placing/swapping at this exact slot. */
	.insert-indicator {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		display: flex;
		align-items: center;
		width: 30%;
		font-size: 1.1rem;
		font-weight: 700;
		color: #14100c;
		background: rgba(111, 191, 111, 0.85);
		pointer-events: none;
	}

	.insert-indicator.right {
		left: auto;
		right: 0;
		justify-content: flex-end;
	}

	/* Purely informational warning badge -- doesn't affect placement/dragging (see
	   insufficientAdrenalinePlacementIds). */
	.adrenaline-warning {
		position: absolute;
		top: -0.35rem;
		right: -0.35rem;
		width: 1rem;
		height: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: #e14b5f;
		color: #14100c;
		font-size: 0.7rem;
		font-weight: 700;
		pointer-events: none;
	}

	.off-gcd-warning {
		width: 0.75rem;
		height: 0.75rem;
		font-size: 0.55rem;
		top: -0.25rem;
		right: -0.25rem;
	}

	/* Purely informational warning badge -- doesn't block/relocate placement (see
	   cooldownViolationPlacementIds). Positioned on the opposite corner from .adrenaline-warning so
	   both can show at once without overlapping. */
	.cooldown-warning {
		position: absolute;
		top: -0.35rem;
		left: -0.35rem;
		width: 1rem;
		height: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #e8b339;
		font-size: 0.75rem;
		line-height: 1;
		text-shadow: 0 0 2px rgba(20, 16, 12, 0.9);
		pointer-events: none;
	}

	.cooldown-warning.off-gcd-warning {
		width: 0.75rem;
		height: 0.75rem;
		font-size: 0.6rem;
		top: -0.25rem;
		left: -0.25rem;
	}

	/* Small badge identifying which weapon a per-weapon special attack belongs to, shown on
	   the bottom-right corner of the shared "Weapon Special Attack" icon -- the opposite
	   corners are already claimed by .adrenaline-warning (top-right) and .cooldown-warning
	   (top-left). */
	.weapon-chip {
		position: absolute;
		bottom: -0.3rem;
		right: -0.3rem;
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 2px;
		border: 1px solid #14100c;
		background: #14100c;
		pointer-events: none;
	}

	.weapon-chip.off-gcd-chip {
		width: 0.7rem;
		height: 0.7rem;
		bottom: -0.2rem;
		right: -0.2rem;
	}

	/* Purely informational -- flags the one placement that actually consumed Greater Fury's
	   guaranteed-crit buff (see allBuffs.greaterFuryCritPlacementIds). The bottom-left corner is
	   the only one not already claimed by .adrenaline-warning/.cooldown-warning/.weapon-chip. */
	.crit-marker {
		position: absolute;
		bottom: -0.35rem;
		left: -0.35rem;
		width: 1rem;
		height: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #f4d78c;
		font-size: 0.8rem;
		line-height: 1;
		text-shadow: 0 0 2px rgba(20, 16, 12, 0.9);
		pointer-events: none;
	}

	/* Same corner as .crit-marker (both are "consumed a next-hit buff" indicators) -- shifted left
	   via .shifted on the rare placement that somehow consumes both in the same tick, so neither
	   marker is fully hidden behind the other. */
	.chaos-roar-marker {
		position: absolute;
		bottom: -0.35rem;
		left: -0.35rem;
		width: 1rem;
		height: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #d97757;
		font-size: 0.75rem;
		line-height: 1;
		text-shadow: 0 0 2px rgba(20, 16, 12, 0.9);
		pointer-events: none;
	}

	.chaos-roar-marker.shifted {
		left: -0.9rem;
	}

	.placed-icon:hover {
		border-color: #d97757;
	}

	.off-gcd-icon {
		width: 1.5rem;
		height: 1.5rem;
	}
</style>
