<script lang="ts">
	interface StatRow {
		label: string;
		value: string | number;
	}

	interface Props {
		anchorId: string;
		title: string;
		stats: StatRow[];
		visible: boolean;
	}

	let { anchorId, title, stats, visible }: Props = $props();

	let popoverEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!popoverEl) return;
		if (visible) {
			popoverEl.showPopover();
		} else {
			popoverEl.hidePopover();
		}
	});
</script>

<div
	bind:this={popoverEl}
	popover="manual"
	class="item-stat-popover"
	style:position-anchor="--{anchorId}"
	role="tooltip"
>
	<div class="item-stat-title">{title}</div>
	<dl class="item-stat-list">
		{#each stats as stat (stat.label)}
			<dt>{stat.label}</dt>
			<dd>{stat.value}</dd>
		{/each}
	</dl>
</div>

<style>
	.item-stat-popover {
		position: fixed;
		margin: 0;
		padding: 0.6rem 0.75rem;
		background: #100c08;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
		pointer-events: none;
		min-width: 10rem;
	}

	@supports (position-anchor: --x) {
		.item-stat-popover {
			position-area: top span-right;
			position-try-fallbacks: flip-block;
			margin-bottom: 0.4rem;
		}
	}

	.item-stat-title {
		font-weight: 600;
		font-size: 0.85rem;
		color: #f4d78c;
		margin-bottom: 0.35rem;
		padding-bottom: 0.3rem;
		border-bottom: 1px solid #3a2f1c;
	}

	.item-stat-list {
		display: grid;
		grid-template-columns: auto auto;
		gap: 0.2rem 0.75rem;
		margin: 0;
		font-size: 0.8rem;
	}

	.item-stat-list dt {
		color: #cbb98e;
	}

	.item-stat-list dd {
		margin: 0;
		color: #e8dcc4;
		text-align: right;
		font-weight: 600;
	}
</style>
