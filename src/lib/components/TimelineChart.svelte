<script lang="ts">
	import { TICK_SECONDS } from '$lib';

	interface Series {
		id: string;
		label: string;
		color: string;
		tickDamage: number[];
		cumulative: number[];
		dpm: number[];
		adrenaline?: number[];
	}

	interface Props {
		damageByTick: number[];
		cumulative: number[];
		dpm: number[];
		/** This setup's own adrenaline-over-time (0-100, or up to 120 with Vestments of havoc's 4pc
		 *  cap raise) -- optional since older callers/tests may not care about the adrenaline chart. */
		adrenaline?: number[];
		timelineLength: number;
		tickSeconds?: number;
		/** Every setup's own damage + adrenaline series, for the multi-setup overlay -- when provided
		 *  (2+ entries), each setup gets its own colored line on all three charts instead of just the
		 *  single damageByTick/cumulative/dpm/adrenaline series above. When absent (or a single
		 *  entry), falls back to the plain single-line rendering keyed off this component's own
		 *  top-level props, so Timeline.svelte's chart still works standalone (and in existing tests)
		 *  without callers needing to know about the overlay at all. */
		overlaySeries?: Series[];
		/** Which of the 3 charts to render -- all default to visible so existing callers/tests are
		 *  unaffected. Lets Timeline.svelte's per-chart toggles hide charts the user doesn't want
		 *  taking up scroll space, without duplicating each chart's own markup/logic elsewhere. */
		showCumulative?: boolean;
		showDpm?: boolean;
		showAdrenaline?: boolean;
	}

	let {
		damageByTick,
		cumulative,
		dpm,
		adrenaline,
		timelineLength,
		tickSeconds = TICK_SECONDS,
		overlaySeries,
		showCumulative = true,
		showDpm = true,
		showAdrenaline = true
	}: Props = $props();

	const DEFAULT_SERIES_ID = '__default';

	const series = $derived<Series[]>(
		overlaySeries && overlaySeries.length > 0
			? overlaySeries
			: [
					{
						id: DEFAULT_SERIES_ID,
						label: 'Cumulative damage',
						color: '#f4d78c',
						tickDamage: damageByTick,
						cumulative,
						dpm,
						adrenaline
					}
				]
	);
	const isOverlay = $derived(series.length > 1);
	const hasAdrenaline = $derived(showAdrenaline && series.some((s) => s.adrenaline !== undefined));

	// Matches the timeline grid's own per-tick column width (Timeline.svelte's
	// `grid-template-columns: repeat(timelineLength, 1.75rem)`) so the chart's x-axis lines up
	// tick-for-tick with the ruler, resource bars, and placed abilities above it, rather than being
	// independently stretched to fill the available width. Everything stays in px (matching the
	// root 16px default) so the SVG viewBox maps 1:1 onto its rendered pixel width.
	const REM_PX = 16;
	const TICK_PX = 1.75 * REM_PX;
	// No left/right padding: tick 0 must sit at x=0 and the last tick at the far right edge, exactly
	// matching Timeline.svelte's ruler/grid (whose tick columns start flush at the grid's own left
	// edge) -- a reserved axis-label margin here would shift the chart out of alignment with it. The
	// y-axis value labels are instead drawn inside the plot area itself (see the <text> elements
	// below), not in a dedicated margin.
	const PAD_LEFT = 0;
	const PAD_RIGHT = 0;
	const PAD_TOP = 14;
	const PAD_BOTTOM = 20;
	const HEIGHT = 180;

	const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
	const plotWidth = $derived(Math.max(1, timelineLength - 1) * TICK_PX);
	const width = $derived(plotWidth + PAD_LEFT + PAD_RIGHT);

	const maxCumulative = $derived(Math.max(1, ...series.flatMap((s) => s.cumulative)));
	const maxDpm = $derived(Math.max(1, ...series.flatMap((s) => s.dpm)));
	// Normally a flat 0-100 scale, but Vestments of havoc's 4pc bonus can raise the cap to 120 --
	// auto-extends past 100 rather than clipping a setup that's actually using the higher cap.
	const maxAdrenaline = $derived(
		Math.max(100, ...series.flatMap((s) => s.adrenaline ?? []))
	);

	function xFor(tick: number): number {
		return PAD_LEFT + tick * TICK_PX;
	}

	function yFor(value: number, max: number): number {
		return PAD_TOP + plotHeight - (value / max) * plotHeight;
	}

	const cumulativeSeriesPoints = $derived(
		series.map((s) => ({
			...s,
			points: s.cumulative.map((v, i) => `${xFor(i)},${yFor(v, maxCumulative)}`).join(' ')
		}))
	);
	const dpmSeriesPoints = $derived(
		series.map((s) => ({
			...s,
			points: s.dpm.map((v, i) => `${xFor(i)},${yFor(v, maxDpm)}`).join(' ')
		}))
	);
	const adrenalineSeriesPoints = $derived(
		series
			.filter((s) => s.adrenaline !== undefined)
			.map((s) => ({
				...s,
				adrenaline: s.adrenaline!,
				points: s.adrenaline!.map((v, i) => `${xFor(i)},${yFor(v, maxAdrenaline)}`).join(' ')
			}))
	);

	// Same "every 5 ticks" convention as Timeline.svelte's own ruler row, so labels land on
	// identical ticks instead of an independently-computed spacing.
	const chartTickCount = $derived(Math.max(...series.map((s) => s.tickDamage.length), 0));
	const xLabels = $derived(
		Array.from({ length: chartTickCount }, (_, i) => i).filter((i) => i % 5 === 0)
	);

	function formatCompact(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
		return Math.round(n).toString();
	}

	let hoverTick: number | null = $state(null);

	function tickFromClientX(svg: SVGSVGElement, clientX: number): number | null {
		const rect = svg.getBoundingClientRect();
		const scaleX = width / rect.width;
		const localX = (clientX - rect.left) * scaleX;
		if (chartTickCount === 0) return null;
		const tick = Math.round((localX - PAD_LEFT) / TICK_PX);
		return Math.max(0, Math.min(chartTickCount - 1, tick));
	}

	function handlePointerMove(e: PointerEvent) {
		const svg = e.currentTarget as SVGSVGElement;
		hoverTick = tickFromClientX(svg, e.clientX);
	}

	function handlePointerLeave() {
		hoverTick = null;
	}

	// Per-series hover readouts -- with 2+ setups overlaid, the tooltip breaks down every setup's
	// own value at the hovered tick (labeled by setup), rather than only the single active series.
	const hoverRows = $derived.by(() => {
		const tick = hoverTick;
		if (tick === null) return [];
		return series.map((s) => ({
			id: s.id,
			label: s.label,
			color: s.color,
			delta: s.tickDamage[tick] ?? 0,
			cumulative: s.cumulative[tick] ?? 0,
			dpm: s.dpm[tick] ?? 0,
			adrenaline: s.adrenaline?.[tick] ?? 0
		}));
	});
	const hoverSeconds = $derived(hoverTick !== null ? (hoverTick * tickSeconds).toFixed(1) : '');

	function clampedTooltipX(tick: number): number {
		const x = xFor(tick);
		return Math.max(PAD_LEFT + 4, Math.min(width - PAD_RIGHT - 4, x));
	}
</script>

<div class="chart-wrap">
	{#if showCumulative}
	<div class="chart-block">
		<h4 class="chart-title">Cumulative damage</h4>
		<div class="chart-legend">
			{#each series as s (s.id)}
				<span class="legend-item">
					<span class="swatch" style:background={s.color}></span>
					{isOverlay ? s.label : 'Cumulative damage'}
				</span>
			{/each}
		</div>
		<svg
			viewBox="0 0 {width} {HEIGHT}"
			class="chart-svg"
			style:width="{width}px"
			role="img"
			aria-label="Cumulative damage over time"
			onpointermove={handlePointerMove}
			onpointerleave={handlePointerLeave}
		>
			<line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={PAD_TOP + plotHeight} class="axis-line" />
			<line
				x1={PAD_LEFT}
				y1={PAD_TOP + plotHeight}
				x2={width - PAD_RIGHT}
				y2={PAD_TOP + plotHeight}
				class="axis-line"
			/>

			<text x={PAD_LEFT + 4} y={PAD_TOP - 3} class="axis-label cumulative-label" text-anchor="start">
				{formatCompact(maxCumulative)}
			</text>
			<text
				x={PAD_LEFT + 4}
				y={PAD_TOP + plotHeight - 3}
				class="axis-label cumulative-label"
				text-anchor="start"
			>
				0
			</text>

			{#each xLabels as tick (tick)}
				<line x1={xFor(tick)} y1={PAD_TOP} x2={xFor(tick)} y2={PAD_TOP + plotHeight} class="grid-line" />
				<text x={xFor(tick)} y={HEIGHT - 6} class="axis-label" text-anchor="middle">
					{(tick * tickSeconds).toFixed(1)}s
				</text>
			{/each}

			{#each cumulativeSeriesPoints as s (s.id)}
				{#if s.cumulative.length > 1}
					<polyline points={s.points} class="line" style:stroke={s.color} />
				{/if}
			{/each}

			{#if hoverTick !== null}
				{@const hx = xFor(hoverTick)}
				<line x1={hx} y1={PAD_TOP} x2={hx} y2={PAD_TOP + plotHeight} class="hover-line" />
				{#each hoverRows as row (row.id)}
					<circle
						cx={hx}
						cy={yFor(row.cumulative, maxCumulative)}
						r="3.5"
						class="hover-dot"
						style:fill={row.color}
					/>
				{/each}
			{/if}
		</svg>

		{#if hoverTick !== null}
			<div class="tooltip" style="left: {(clampedTooltipX(hoverTick) / width) * 100}%">
				<div class="tooltip-title">Tick {hoverTick} · {hoverSeconds}s</div>
				{#each hoverRows as row (row.id)}
					<div class="tooltip-row">
						<span class="swatch" style:background={row.color}></span>
						{isOverlay ? `${row.label}: ` : 'Total: '}{formatCompact(row.cumulative)}
						<span class="tooltip-delta">(+{formatCompact(row.delta)})</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
	{/if}

	{#if showDpm}
	<div class="chart-block">
		<h4 class="chart-title">DPM (60s sliding window)</h4>
		<div class="chart-legend">
			{#each series as s (s.id)}
				<span class="legend-item">
					<span class="swatch" style:background={s.color}></span>
					{isOverlay ? s.label : 'DPM (60s sliding window)'}
				</span>
			{/each}
		</div>
		<svg
			viewBox="0 0 {width} {HEIGHT}"
			class="chart-svg"
			style:width="{width}px"
			role="img"
			aria-label="Damage per minute over time, 60 second sliding window"
			onpointermove={handlePointerMove}
			onpointerleave={handlePointerLeave}
		>
			<line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={PAD_TOP + plotHeight} class="axis-line" />
			<line
				x1={PAD_LEFT}
				y1={PAD_TOP + plotHeight}
				x2={width - PAD_RIGHT}
				y2={PAD_TOP + plotHeight}
				class="axis-line"
			/>

			<text x={PAD_LEFT + 4} y={PAD_TOP - 3} class="axis-label dpm-label" text-anchor="start">
				{formatCompact(maxDpm)}
			</text>
			<text
				x={PAD_LEFT + 4}
				y={PAD_TOP + plotHeight - 3}
				class="axis-label dpm-label"
				text-anchor="start"
			>
				0
			</text>

			{#each xLabels as tick (tick)}
				<line x1={xFor(tick)} y1={PAD_TOP} x2={xFor(tick)} y2={PAD_TOP + plotHeight} class="grid-line" />
				<text x={xFor(tick)} y={HEIGHT - 6} class="axis-label" text-anchor="middle">
					{(tick * tickSeconds).toFixed(1)}s
				</text>
			{/each}

			{#each dpmSeriesPoints as s (s.id)}
				{#if s.dpm.length > 1}
					<polyline points={s.points} class="line" style:stroke={s.color} />
				{/if}
			{/each}

			{#if hoverTick !== null}
				{@const hx = xFor(hoverTick)}
				<line x1={hx} y1={PAD_TOP} x2={hx} y2={PAD_TOP + plotHeight} class="hover-line" />
				{#each hoverRows as row (row.id)}
					<circle cx={hx} cy={yFor(row.dpm, maxDpm)} r="3.5" class="hover-dot" style:fill={row.color} />
				{/each}
			{/if}
		</svg>

		{#if hoverTick !== null}
			<div class="tooltip" style="left: {(clampedTooltipX(hoverTick) / width) * 100}%">
				<div class="tooltip-title">Tick {hoverTick} · {hoverSeconds}s</div>
				{#each hoverRows as row (row.id)}
					<div class="tooltip-row">
						<span class="swatch" style:background={row.color}></span>
						{isOverlay ? `${row.label}: ` : 'DPM: '}{formatCompact(row.dpm)}
					</div>
				{/each}
			</div>
		{/if}
	</div>
	{/if}

	{#if hasAdrenaline}
		<div class="chart-block">
			<h4 class="chart-title">Adrenaline</h4>
			<div class="chart-legend">
				{#each series as s (s.id)}
					<span class="legend-item">
						<span class="swatch" style:background={s.color}></span>
						{isOverlay ? s.label : 'Adrenaline'}
					</span>
				{/each}
			</div>
			<svg
				viewBox="0 0 {width} {HEIGHT}"
				class="chart-svg"
				style:width="{width}px"
				role="img"
				aria-label="Adrenaline over time"
				onpointermove={handlePointerMove}
				onpointerleave={handlePointerLeave}
			>
				<line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={PAD_TOP + plotHeight} class="axis-line" />
				<line
					x1={PAD_LEFT}
					y1={PAD_TOP + plotHeight}
					x2={width - PAD_RIGHT}
					y2={PAD_TOP + plotHeight}
					class="axis-line"
				/>

				<text x={PAD_LEFT + 4} y={PAD_TOP - 3} class="axis-label adrenaline-label" text-anchor="start">
					{Math.round(maxAdrenaline)}%
				</text>
				<text
					x={PAD_LEFT + 4}
					y={PAD_TOP + plotHeight - 3}
					class="axis-label adrenaline-label"
					text-anchor="start"
				>
					0%
				</text>

				{#each xLabels as tick (tick)}
					<line x1={xFor(tick)} y1={PAD_TOP} x2={xFor(tick)} y2={PAD_TOP + plotHeight} class="grid-line" />
					<text x={xFor(tick)} y={HEIGHT - 6} class="axis-label" text-anchor="middle">
						{(tick * tickSeconds).toFixed(1)}s
					</text>
				{/each}

				{#each adrenalineSeriesPoints as s (s.id)}
					{#if s.adrenaline.length > 1}
						<polyline points={s.points} class="line" style:stroke={s.color} />
					{/if}
				{/each}

				{#if hoverTick !== null}
					{@const hx = xFor(hoverTick)}
					<line x1={hx} y1={PAD_TOP} x2={hx} y2={PAD_TOP + plotHeight} class="hover-line" />
					{#each hoverRows as row (row.id)}
						<circle
							cx={hx}
							cy={yFor(row.adrenaline, maxAdrenaline)}
							r="3.5"
							class="hover-dot"
							style:fill={row.color}
						/>
					{/each}
				{/if}
			</svg>

			{#if hoverTick !== null}
				<div class="tooltip" style="left: {(clampedTooltipX(hoverTick) / width) * 100}%">
					<div class="tooltip-title">Tick {hoverTick} · {hoverSeconds}s</div>
					{#each hoverRows as row (row.id)}
						<div class="tooltip-row">
							<span class="swatch" style:background={row.color}></span>
							{isOverlay ? `${row.label}: ` : 'Adrenaline: '}{Math.round(row.adrenaline)}%
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.chart-wrap {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		width: max-content;
	}

	.chart-block {
		position: relative;
	}

	.chart-title {
		margin: 0 0 0.4rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #d8b566;
	}

	.chart-legend {
		display: flex;
		gap: 1.25rem;
		font-size: 0.8rem;
		color: #cbb98e;
		margin-bottom: 0.4rem;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.swatch {
		display: inline-block;
		width: 0.9rem;
		height: 0.15rem;
		border-radius: 2px;
	}

	.chart-svg {
		display: block;
		height: 180px;
		cursor: crosshair;
	}

	.axis-line {
		stroke: #3a2f1c;
		stroke-width: 1;
	}

	.grid-line {
		stroke: #241d13;
		stroke-width: 1;
	}

	.axis-label {
		font-size: 9px;
		fill: #8a7a5c;
	}

	.cumulative-label {
		fill: #cbb98e;
	}

	.dpm-label {
		fill: #d8a688;
	}

	.adrenaline-label {
		fill: #a9c9e8;
	}

	.line {
		fill: none;
		stroke-width: 2;
	}

	.hover-line {
		stroke: #5a4d33;
		stroke-width: 1;
		stroke-dasharray: 3 3;
	}

	.hover-dot {
		stroke: #1a1510;
		stroke-width: 1;
	}

	.tooltip-delta {
		color: #8a7a5c;
	}

	.tooltip {
		position: absolute;
		top: 0.5rem;
		transform: translateX(-50%);
		background: #1f1912;
		border: 1px solid #4a3d26;
		border-radius: 6px;
		padding: 0.4rem 0.6rem;
		font-size: 0.75rem;
		color: #e8ddc4;
		pointer-events: none;
		white-space: nowrap;
		z-index: 10;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
	}

	.tooltip-title {
		font-weight: 600;
		margin-bottom: 0.2rem;
		color: #cbb98e;
	}

	.tooltip-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
</style>
