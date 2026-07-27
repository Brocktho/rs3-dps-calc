<script lang="ts">
	import {
		abilityTickSpan,
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
		requiredTimelineLength,
		resolveBuffs,
		resolveChannels,
		runningAverageDps,
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
		gearContext: GearContext;
		placements: TimelinePlacement[];
		styleFilterEnabled: boolean;
		timelineLength: number;
	}

	let {
		abilities,
		combatStyle,
		adTotal,
		gearContext,
		placements = $bindable(),
		styleFilterEnabled = $bindable(),
		timelineLength = $bindable()
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
		| { kind: 'place'; tick: number }
		| { kind: 'insert'; anchorId: string; side: 'before' | 'after'; tick: number };
	let hoverIntent: DragIntent | null = $state(null);

	const filteredAbilities = $derived.by(() => {
		let list = abilities;
		if (styleFilterEnabled && combatStyle) {
			list = list.filter((a) => a.style === combatStyle);
		}
		const needle = paletteSearch.trim().toLowerCase();
		if (needle) list = list.filter((a) => a.name.toLowerCase().includes(needle));
		return list;
	});

	function abilityByName(name: string): Ability | undefined {
		return abilities.find((a) => a.name === name);
	}

	function placeAbility(ability: Ability) {
		const tick = nextOpenTick(ability, placements, abilities, timelineLength);
		if (tick === null) return;
		placements = [...placements, { id: crypto.randomUUID(), abilityName: ability.name, startTick: tick }];
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

	function onPaletteDragStart(e: DragEvent, ability: Ability) {
		e.dataTransfer?.setData('text/x-timeline-new-ability', ability.name);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
		draggingAbility = ability;
		draggingPlacementId = null;
		draggingOriginTick = null;
	}

	function onPlacementDragStart(e: DragEvent, placement: TimelinePlacement) {
		e.dataTransfer?.setData('text/x-timeline-move-placement', placement.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		draggingAbility = abilityByName(placement.abilityName) ?? null;
		draggingPlacementId = placement.id;
		draggingOriginTick = placement.startTick;
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

	function computeDragIntent(e: DragEvent): DragIntent | null {
		if (!gridEl || timelineLength === 0) return null;
		const rect = gridEl.getBoundingClientRect();
		const colWidth = rect.width / timelineLength;
		const xPx = e.clientX - rect.left;
		const tick = Math.max(0, Math.min(timelineLength - 1, Math.floor(xPx / colWidth)));

		if (!draggingAbility || isOffGcdAbility(draggingAbility)) {
			return { kind: 'place', tick };
		}

		const covering = gcdPlacementAt(tick, placements, abilities);
		if (!covering || covering.id === draggingPlacementId) {
			return { kind: 'place', tick };
		}
		const coveringAbility = abilityByName(covering.abilityName);
		if (!coveringAbility) return { kind: 'place', tick };

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
		return { kind: 'place', tick: covering.startTick };
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
		placements = result;
		const required = requiredTimelineLength(placements, abilities);
		if (required > timelineLength) timelineLength = required;
	}

	function handlePlaceDrop(e: DragEvent, tick: number) {
		const movingId = e.dataTransfer?.getData('text/x-timeline-move-placement');
		if (movingId) {
			const placement = placements.find((p) => p.id === movingId);
			const ability = placement ? abilityByName(placement.abilityName) : undefined;
			if (!placement || !ability) return;
			if (canPlaceAbility(ability, tick, placements, abilities, timelineLength, placement.id)) {
				placements = placements.map((p) => (p.id === movingId ? { ...p, startTick: tick } : p));
				return;
			}
			const swapTarget = findSwapTarget(movingId, tick, placements, abilities, timelineLength);
			if (swapTarget) {
				// A swap exchanges each ability's own ORIGINAL start tick, not the raw tick the
				// pointer was dropped at -- see findSwapTarget's doc comment for why using the
				// raw drop tick here could leave the two new positions overlapping each other.
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
		placements = [...placements, { id: crypto.randomUUID(), abilityName: ability.name, startTick: tick }];
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

	// Buff lane: each self-buff placement packed into the minimum number of stacked rows needed
	// (a compact Gantt -- only buffs whose active windows actually overlap get separate rows).
	const packedBuffs = $derived(packIntoLanes(resolveBuffs(placements, abilities, timelineLength)));
	const buffLaneCount = $derived(
		packedBuffs.reduce((max, b) => Math.max(max, b.lane + 1), 0)
	);
	const buffLanes = $derived(
		Array.from({ length: buffLaneCount }, (_, lane) => packedBuffs.filter((b) => b.lane === lane))
	);

	// Channel/DoT lane: same lane-packing, over each channelled placement's (possibly
	// interruption-truncated) hit window.
	const packedChannels = $derived(
		packIntoLanes(
			resolveChannels(placements, abilities, timelineLength).map((c) => ({
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

	const gearForDamage = $derived(gearContext);

	const tickDamage = $derived(
		damageByTick(placements, abilities, adTotal, gearForDamage, timelineLength)
	);
	const cumulative = $derived(cumulativeDamage(tickDamage));
	const avgDps = $derived(runningAverageDps(tickDamage));
	const totalDamage = $derived(cumulative[cumulative.length - 1] ?? 0);
	const overallAvgDps = $derived(avgDps[avgDps.length - 1] ?? 0);

	const tickIndices = $derived(Array.from({ length: timelineLength }, (_, i) => i));

	function extendTimeline() {
		timelineLength += 50;
	}

	function clearTimeline() {
		placements = [];
	}
</script>

<div class="timeline-builder">
	<div class="timeline-header">
		<h2>Rotation Timeline</h2>
		<div class="timeline-summary">
			<span>Total damage: <strong>{totalDamage.toLocaleString()}</strong></span>
			<span>Avg DPS: <strong>{overallAvgDps.toFixed(0)}</strong></span>
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
		<span class="timeline-length">{timelineLength} ticks ({(timelineLength * TICK_SECONDS).toFixed(1)}s)</span>
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

			{#each buffLanes as lane, laneIndex (laneIndex)}
				<div class="timeline-row buff-row" style:grid-column="1 / -1">
					{#each lane as buff (buff.placementId)}
						<div
							class="lane-box buff-box"
							style:grid-column="{buff.startTick + 1} / span {buff.endTick - buff.startTick}"
							style:background-color={colorForAbility(buff.abilityName)}
							title="{buff.abilityName} (ticks {buff.startTick}-{buff.endTick - 1})"
						>
							{buff.abilityName}
						</div>
					{/each}
				</div>
			{/each}

			{#each channelLanes as lane, laneIndex (laneIndex)}
				<div class="timeline-row channel-row" style:grid-column="1 / -1">
					{#each lane as channel (channel.placementId)}
						<div
							class="lane-box channel-box"
							style:grid-column="{channel.startTick + 1} / span {channel.barEndTick -
								channel.startTick}"
							style:border-color={colorForAbility(channel.abilityName)}
							title="{channel.abilityName} (ticks {channel.startTick}-{channel.barEndTick - 1})"
						>
							<span class="channel-label">{channel.abilityName}</span>
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
								{#if insertAnchorId === cell.placement!.id}
									<span class="insert-indicator" class:right={insertSide === 'after'} aria-hidden="true">
										{insertSide === 'after' ? '▸' : '◂'}
									</span>
								{/if}
							</button>
						{/if}
					{/if}
				{/each}
				{#if showGhost && !ghostIsOffGcd && placeGhostTick !== null}
					<div
						class="ghost-box"
						class:invalid={!ghostValid}
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
								</button>
							{/if}
						{/each}
					</div>
				{/each}
				{#if showGhost && ghostIsOffGcd && placeGhostTick !== null}
					<div
						class="ghost-box off-gcd-ghost"
						class:invalid={!ghostValid}
						style:grid-column="{placeGhostTick + 1} / span 1"
						style:grid-row="1"
						aria-hidden="true"
					></div>
				{/if}
			</div>
		</div>
	</div>

	<TimelineChart damageByTick={tickDamage} cumulative={cumulative} avgDps={avgDps} />
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

	.off-gcd-ghost {
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

	.placed-icon:hover {
		border-color: #d97757;
	}

	.off-gcd-icon {
		width: 1.5rem;
		height: 1.5rem;
	}
</style>
