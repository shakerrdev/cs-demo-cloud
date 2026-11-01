<script lang="ts">
	import { buyLabels, type BuyType, type Side, type TeamKey } from '@cs-demo-cloud/replay';
	import RoundStack, { type StackEntry } from './RoundStack.svelte';

	interface RoundRow {
		number: number;
		teamASide: Side;
		winnerTeam: TeamKey | null;
	}

	interface Props {
		demoId: string;
		version: number;
		map: string;
		rounds: RoundRow[];
		buys: Map<number, Record<TeamKey, BuyType> | null>;
		teamNames: Record<TeamKey, string>;
	}

	let { demoId, version, map, rounds, buys, teamNames }: Props = $props();

	let team = $state<TeamKey>('a');
	let side = $state<Side>('T');
	let buy = $state<'any' | BuyType>('any');
	let result = $state<'any' | 'won' | 'lost'>('any');
	let opponents = $state(false);

	const sideOf = (row: RoundRow, key: TeamKey): Side =>
		key === 'a' ? row.teamASide : row.teamASide === 'CT' ? 'T' : 'CT';

	const chosen = $derived(
		rounds.filter((row) => {
			if (sideOf(row, team) !== side) return false;
			if (buy !== 'any' && buys.get(row.number)?.[team] !== buy) return false;
			if (result === 'won' && row.winnerTeam !== team) return false;
			if (result === 'lost' && row.winnerTeam === team) return false;
			return true;
		})
	);

	const entries = $derived(
		chosen.map((row): StackEntry => ({
			key: String(row.number),
			demoId,
			version,
			round: row.number,
			team
		}))
	);
</script>

<div class="overlay">
	<div class="filters">
		<select bind:value={team} aria-label="Team">
			<option value="a">{teamNames.a}</option>
			<option value="b">{teamNames.b}</option>
		</select>
		<div class="toggle" role="group" aria-label="Side">
			{#each ['T', 'CT'] as const as key (key)}
				<button type="button" aria-pressed={side === key} onclick={() => (side = key)}
					>{key === 'T' ? 'T side' : 'CT side'}</button
				>
			{/each}
		</div>
		<select bind:value={buy} aria-label="Buy">
			<option value="any">Any buy</option>
			{#each Object.entries(buyLabels) as [key, label] (key)}
				<option value={key}>{label}</option>
			{/each}
		</select>
		<select bind:value={result} aria-label="Result">
			<option value="any">Won or lost</option>
			<option value="won">Rounds won</option>
			<option value="lost">Rounds lost</option>
		</select>
		<label class="check"><input type="checkbox" bind:checked={opponents} /> Opponents</label>
		<span class="count">
			{chosen.length} rounds{chosen.length ? `: ${chosen.map((r) => r.number).join(', ')}` : ''}
		</span>
	</div>
	<RoundStack {map} {entries} {opponents} />
</div>

<style>
	.overlay {
		display: grid;
		gap: 12px;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	select {
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 4px 8px;
	}

	.toggle {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 6px;
		overflow: hidden;
	}

	.toggle button {
		background: transparent;
		color: var(--muted);
		border: 0;
		padding: 4px 10px;
		cursor: pointer;
	}

	.toggle button[aria-pressed='true'] {
		background: var(--border);
		color: var(--text);
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--muted);
	}

	.count {
		margin-left: auto;
		color: var(--muted);
		font-size: 0.9em;
		font-variant-numeric: tabular-nums;
	}
</style>
