<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Feedback - RS3 Ability Damage Calculator</title>
</svelte:head>

<main class="feedback-page">
	<h1>Submitted feedback</h1>
	{#if data.feedback.length === 0}
		<p class="empty">No feedback submitted yet.</p>
	{:else}
		<ul>
			{#each data.feedback as entry (entry.id)}
				<li>
					<p class="message">{entry.message}</p>
					<time>{entry.created_at}</time>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.feedback-page {
		max-width: 48rem;
		margin: 0 auto;
		padding: 2rem 1.5rem;
		color: #e8dcc0;
	}

	h1 {
		margin: 0 0 1.5rem;
	}

	.empty {
		opacity: 0.7;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	li {
		background: #241d12;
		border: 1px solid #5a4a2c;
		border-radius: 6px;
		padding: 0.75rem 1rem;
	}

	.message {
		margin: 0 0 0.4rem;
		white-space: pre-wrap;
		word-break: break-word;
	}

	time {
		font-size: 0.8rem;
		opacity: 0.6;
	}
</style>
