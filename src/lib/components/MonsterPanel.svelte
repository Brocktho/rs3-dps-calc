<script lang="ts">
	import { bosses, type Boss, type HitChanceBreakdown } from '$lib';
	import Combobox from './Combobox.svelte';

	interface Props {
		selectedBossName: string;
		/** Player's hit chance against the selected boss with their current combat style/gear
		 *  (full raw -> adjustments -> cap breakdown for provenance display), or null when no
		 *  boss is selected or the player has no combat style equipped. Computed by the parent,
		 *  which owns the player's accuracy/gear state. */
		hitChance?: HitChanceBreakdown | null;
	}

	let { selectedBossName = $bindable(), hitChance = null }: Props = $props();

	const selectedBoss = $derived(bosses.find((b) => b.name === selectedBossName) ?? null);

	/** e.g. "Raw 118.8% − Ring of X 10% = 108.8%, capped at 100%" -- only shown when an
	 *  adjustment actually applied, so the common no-adjustment case stays a plain value. */
	const hitChanceProvenance = $derived.by(() => {
		if (!hitChance || hitChance.adjustments.length === 0) return null;
		const parts = hitChance.adjustments.map(
			(a) => `${a.amountPercent >= 0 ? '+' : '−'} ${a.source.label} ${Math.abs(a.amountPercent)}%`
		);
		const capNote = hitChance.adjusted !== hitChance.final ? `, capped to ${hitChance.final.toFixed(1)}%` : '';
		return `Raw ${hitChance.raw.toFixed(1)}% ${parts.join(' ')} = ${hitChance.adjusted.toFixed(1)}%${capNote}`;
	});

	function formatAffinity(value: number): string {
		return `${value}%`;
	}

	function formatImmune(value: boolean): string {
		return value ? 'Yes' : 'No';
	}
</script>

<div class="hud-window">
	<div class="hud-panel">
		<section class="monster-section">
			<h3>Monster</h3>
			<Combobox
				id="boss-combobox"
				options={bosses}
				bind:value={selectedBossName}
				getValue={(b) => b.name}
				getLabel={(b) => b.name}
				placeholder="Type to search bosses..."
				emptyOptionLabel="-- select a boss --"
			>
				{#snippet option(boss: Boss)}
					<img class="option-icon" src={boss.iconPath} alt="" />
					<span class="option-text">
						<span class="option-label">{boss.name}</span>
						<small class="option-sub">Combat level {boss.combatLevel}</small>
					</span>
				{/snippet}
			</Combobox>
			{#if selectedBoss}
				<div class="monster-portrait">
					<img src={selectedBoss.iconPath} alt={selectedBoss.name} />
				</div>
			{/if}
		</section>

		<section class="monster-section">
			<h3>Defensive stats</h3>
			<div class="stat-rows">
				<div class="stat-row">
					<span class="stat-row-label">Armour</span>
					<span class="stat-row-value">{selectedBoss?.armour ?? '-'}</span>
				</div>
				<div class="stat-row">
					<span class="stat-row-label">Defence level</span>
					<span class="stat-row-value">{selectedBoss?.defenceLevel ?? '-'}</span>
				</div>
				<div class="stat-row">
					<span class="stat-row-label">Life points</span>
					<span class="stat-row-value"
						>{selectedBoss ? (selectedBoss.lifePoints ?? 'Variable') : '-'}</span
					>
				</div>
				<div class="stat-row">
					<span class="stat-row-label">Weakness</span>
					<span class="stat-row-value"
						>{selectedBoss ? (selectedBoss.weakness ?? 'None') : '-'}</span
					>
				</div>
				<div class="stat-row">
					<span class="stat-row-label">Susceptible</span>
					<span class="stat-row-value"
						>{selectedBoss ? formatAffinity(selectedBoss.affinityWeakness) : '-'}</span
					>
				</div>
				<div class="stat-row">
					<span class="stat-row-label">Your hit chance</span>
					<span class="stat-row-value" title={hitChanceProvenance}
						>{selectedBoss && hitChance !== null ? `${hitChance.final.toFixed(1)}%` : '-'}</span
					>
				</div>
				{#if hitChanceProvenance}
					<div class="stat-row hit-chance-provenance">{hitChanceProvenance}</div>
				{/if}
			</div>
		</section>

		<section class="monster-section">
			<h3>Affinity (hit chance)</h3>
			<table class="stat-table">
				<thead>
					<tr>
						<th>Weakness</th>
						<th>Melee</th>
						<th>Ranged</th>
						<th>Magic</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>{selectedBoss ? formatAffinity(selectedBoss.affinityWeakness) : '-'}</td>
						<td>{selectedBoss ? formatAffinity(selectedBoss.affinityMelee) : '-'}</td>
						<td>{selectedBoss ? formatAffinity(selectedBoss.affinityRanged) : '-'}</td>
						<td>{selectedBoss ? formatAffinity(selectedBoss.affinityMagic) : '-'}</td>
					</tr>
				</tbody>
			</table>
		</section>

		<section class="monster-section">
			<h3>Immunities</h3>
			<table class="stat-table">
				<thead>
					<tr>
						<th>Poison</th>
						<th>Deflect</th>
						<th>Stun</th>
						<th>Stat drain</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>{selectedBoss ? formatImmune(selectedBoss.immuneToPoison) : '-'}</td>
						<td>{selectedBoss ? formatImmune(selectedBoss.immuneToDeflect) : '-'}</td>
						<td>{selectedBoss ? formatImmune(selectedBoss.immuneToStun) : '-'}</td>
						<td>{selectedBoss ? formatImmune(selectedBoss.immuneToDrain) : '-'}</td>
					</tr>
				</tbody>
			</table>
		</section>
	</div>
</div>

<style>
	.hud-window {
		border: 2px solid #5a4a2c;
		border-radius: 6px;
		background: linear-gradient(180deg, #241d14 0%, #1a140d 100%);
		box-shadow:
			0 0 0 1px #0a0704 inset,
			0 4px 12px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}

	.hud-panel {
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.monster-section h3 {
		margin: 0 0 0.6rem;
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #d8b566;
		border-bottom: 1px solid #3a2f1c;
		padding-bottom: 0.3rem;
	}

	/* Boss images are full character-art portraits (varying, often large, dimensions) rather
	   than small square icons -- scale down to fit the panel while keeping their own aspect
	   ratio, rather than forcing a fixed width/height. */
	.monster-portrait {
		margin-top: 0.75rem;
		display: flex;
		justify-content: center;
	}

	.monster-portrait img {
		max-width: 100%;
		max-height: 10rem;
		width: auto;
		height: auto;
	}

	/* Boss combobox option icons: same full character-art portraits as .monster-portrait, so
	   constrain only height and let width scale to avoid stretching into a square, same fix
	   as the boost potion icons elsewhere in the app. */
	.option-icon {
		height: 28px;
		width: auto;
		flex-shrink: 0;
	}

	.option-text {
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}

	.option-sub {
		color: #a89468;
		font-size: 0.75em;
	}

	.stat-rows {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
	}

	.stat-row-label {
		color: #cbb98e;
	}

	.stat-row-value {
		color: #e8dcc4;
		font-weight: 600;
	}

	.hit-chance-provenance {
		font-size: 0.72rem;
		color: #a89a78;
	}

	.stat-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	.stat-table th,
	.stat-table td {
		padding: 0.4rem 0.5rem;
		text-align: center;
		border: 1px solid #3a2f1c;
	}

	.stat-table th {
		color: #d8b566;
		background: #1a140d;
		font-weight: 600;
		text-transform: uppercase;
		font-size: 0.7rem;
		letter-spacing: 0.03em;
	}

	.stat-table td {
		color: #a89468;
	}
</style>
