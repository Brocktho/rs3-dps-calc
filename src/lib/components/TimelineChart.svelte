<script lang="ts">
	import { TICK_SECONDS } from '$lib';

	interface Props {
		damageByTick: number[];
		cumulative: number[];
		avgDps: number[];
		tickSeconds?: number;
	}

	let { damageByTick, cumulative, avgDps, tickSeconds = TICK_SECONDS }: Props = $props();

	const WIDTH = 900;
	const HEIGHT = 220;
	const PAD_LEFT = 55;
	const PAD_RIGHT = 55;
	const PAD_TOP = 12;
	const PAD_BOTTOM = 28;

	const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
	const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

	const maxCumulative = $derived(Math.max(1, ...cumulative));
	const maxAvgDps = $derived(Math.max(1, ...avgDps));

	function xFor(index: number, count: number): number {
		if (count <= 1) return PAD_LEFT;
		return PAD_LEFT + (index / (count - 1)) * plotWidth;
	}

	function yForCumulative(value: number): number {
		return PAD_TOP + plotHeight - (value / maxCumulative) * plotHeight;
	}

	function yForDps(value: number): number {
		return PAD_TOP + plotHeight - (value / maxAvgDps) * plotHeight;
	}

	const cumulativePoints = $derived(
		cumulative.map((v, i) => `${xFor(i, cumulative.length)},${yForCumulative(v)}`).join(' ')
	);
	const dpsPoints = $derived(
		avgDps.map((v, i) => `${xFor(i, avgDps.length)},${yForDps(v)}`).join(' ')
	);

	// X-axis labels every ~5 seconds, spaced by tick count rather than a fixed tick interval so
	// long timelines don't get overcrowded.
	const labelEveryTicks = $derived(Math.max(5, Math.round(damageByTick.length / 12)));
	const xLabels = $derived(
		damageByTick
			.map((_, i) => i)
			.filter((i) => i % labelEveryTicks === 0)
			.map((i) => ({ tick: i, seconds: (i * tickSeconds).toFixed(0) }))
	);

	function formatCompact(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
		return Math.round(n).toString();
	}
</script>

<div class="chart-wrap">
	<div class="chart-legend">
		<span class="legend-item"><span class="swatch cumulative"></span> Cumulative damage</span>
		<span class="legend-item"><span class="swatch dps"></span> Running average DPS</span>
	</div>
	<svg viewBox="0 0 {WIDTH} {HEIGHT}" class="chart-svg" role="img" aria-label="Damage over time">
		<line
			x1={PAD_LEFT}
			y1={PAD_TOP}
			x2={PAD_LEFT}
			y2={PAD_TOP + plotHeight}
			class="axis-line"
		/>
		<line
			x1={PAD_LEFT}
			y1={PAD_TOP + plotHeight}
			x2={PAD_LEFT + plotWidth}
			y2={PAD_TOP + plotHeight}
			class="axis-line"
		/>

		<text x={PAD_LEFT - 6} y={PAD_TOP + 4} class="axis-label cumulative-label" text-anchor="end">
			{formatCompact(maxCumulative)}
		</text>
		<text
			x={PAD_LEFT - 6}
			y={PAD_TOP + plotHeight}
			class="axis-label cumulative-label"
			text-anchor="end"
		>
			0
		</text>
		<text
			x={PAD_LEFT + plotWidth + 6}
			y={PAD_TOP + 4}
			class="axis-label dps-label"
			text-anchor="start"
		>
			{formatCompact(maxAvgDps)}
		</text>

		{#each xLabels as label (label.tick)}
			<text
				x={xFor(label.tick, damageByTick.length)}
				y={HEIGHT - 8}
				class="axis-label"
				text-anchor="middle"
			>
				{label.seconds}s
			</text>
		{/each}

		{#if cumulative.length > 1}
			<polyline points={cumulativePoints} class="line cumulative-line" />
			<polyline points={dpsPoints} class="line dps-line" />
		{/if}
	</svg>
</div>

<style>
	.chart-wrap {
		margin-top: 1.25rem;
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

	.swatch.cumulative {
		background: #f4d78c;
	}

	.swatch.dps {
		background: #d97757;
	}

	.chart-svg {
		width: 100%;
		height: auto;
		display: block;
	}

	.axis-line {
		stroke: #3a2f1c;
		stroke-width: 1;
	}

	.axis-label {
		font-size: 9px;
		fill: #8a7a5c;
	}

	.cumulative-label {
		fill: #cbb98e;
	}

	.dps-label {
		fill: #d8a688;
	}

	.line {
		fill: none;
		stroke-width: 2;
	}

	.cumulative-line {
		stroke: #f4d78c;
	}

	.dps-line {
		stroke: #d97757;
	}
</style>
