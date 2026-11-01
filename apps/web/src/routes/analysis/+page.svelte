<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { buyLabels, mapTitle } from '@cs-demo-cloud/replay';
	import RoundStack, { type StackEntry } from '#lib/components/RoundStack.svelte';
	import { formatDate } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let teammates = $state(true);
	let opponents = $state(false);

	const entries = $derived(
		data.rounds.map((r): StackEntry => ({
			key: `${r.demoId}/${r.round}`,
			demoId: r.demoId,
			version: r.version,
			round: r.round,
			team: r.team,
			steamid: data.player
		}))
	);
	const matchCount = $derived(new Set(data.rounds.map((r) => r.demoId)).size);
	const wins = $derived(data.rounds.filter((r) => r.won).length);
	const playerName = $derived(data.players.find((p) => p.steamid === data.player)?.name ?? '');

	function set(key: string, value: string) {
		const url = new URL(page.url.href);
		if (value) url.searchParams.set(key, value);
		else url.searchParams.delete(key);
		if (key === 'player') url.searchParams.delete('map');
		goto(url, { reset: false, replace: true });
	}
</script>

<svelte:head><title>Analysis · cs-demo-cloud</title></svelte:head>

<div class="heading">
	<h1>Analysis</h1>
	<p class="lead">
		Overlay every matching round of a player across your library to see how they set up and move.
	</p>
</div>

<div class="filters">
	<select
		value={data.player ?? ''}
		onchange={(e) => set('player', e.currentTarget.value)}
		aria-label="Player"
	>
		{#if !data.player}<option value="">Choose a player</option>{/if}
		{#each data.players as p (p.steamid)}
			<option value={p.steamid}>{p.name}</option>
		{/each}
	</select>
	{#if data.filters}
		<select
			value={data.filters.map}
			onchange={(e) => set('map', e.currentTarget.value)}
			aria-label="Map"
		>
			{#each data.maps as m (m.name)}
				<option value={m.name}>{mapTitle(m.name)} ({m.count})</option>
			{/each}
		</select>
		<div class="toggle" role="group" aria-label="Side">
			{#each ['T', 'CT'] as const as key (key)}
				<button
					type="button"
					aria-pressed={data.filters.side === key}
					onclick={() => set('side', key)}>{key} side</button
				>
			{/each}
		</div>
		<select
			value={data.filters.buy}
			onchange={(e) => set('buy', e.currentTarget.value)}
			aria-label="Buy"
		>
			<option value="any">Any buy</option>
			{#each Object.entries(buyLabels) as [key, label] (key)}
				<option value={key}>{label}</option>
			{/each}
		</select>
		<select
			value={data.filters.result}
			onchange={(e) => set('result', e.currentTarget.value)}
			aria-label="Result"
		>
			<option value="any">Won or lost</option>
			<option value="won">Rounds won</option>
			<option value="lost">Rounds lost</option>
		</select>
		<label class="check"><input type="checkbox" bind:checked={teammates} /> Teammates</label>
		<label class="check"><input type="checkbox" bind:checked={opponents} /> Opponents</label>
	{/if}
</div>

{#if !data.player}
	<p class="empty">
		Pick a player to start. Mark yourself with <b>This is me</b> on your player page to start with you.
	</p>
{:else if !data.filters?.map}
	<p class="empty">No parsed matches with {playerName} yet.</p>
{:else if !data.rounds.length}
	<p class="empty">No rounds match these filters.</p>
{:else}
	<p class="summary">
		<b>{playerName}</b> on {mapTitle(data.filters.map)}, {data.filters.side} side: {data.total}
		{data.total === 1 ? 'round' : 'rounds'} in {matchCount}
		{matchCount === 1 ? 'match' : 'matches'}, {wins} won{data.total > data.rounds.length
			? ` · showing the latest ${data.rounds.length}`
			: ''}.
	</p>
	<div class="layout">
		<RoundStack map={data.filters.map} {entries} {teammates} {opponents} />
		<ol class="list">
			{#each data.rounds as r (r.demoId + r.round)}
				<li>
					<a href="/demos/{r.demoId}#round-{r.round}">
						<span class="dot" class:won={r.won}></span>
						Round {r.round}
						<small>{formatDate(r.playedAt)}</small>
					</a>
				</li>
			{/each}
		</ol>
	</div>
{/if}

<style>
	.heading h1 {
		margin: 0;
		font-size: 1.5rem;
	}

	.lead,
	.empty,
	.summary,
	small {
		color: var(--muted);
	}

	.lead {
		margin: 4px 0 16px;
	}

	.summary b {
		color: var(--text);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}

	select {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 5px 8px;
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
		padding: 5px 10px;
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

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 220px;
		gap: 16px;
		align-items: start;
		background: var(--surface);
		border-radius: var(--radius);
		padding: 14px;
	}

	@media (max-width: 860px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 760px;
		overflow: auto;
	}

	.list a {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 5px 8px;
		border-radius: 6px;
		color: inherit;
		text-decoration: none;
		font-size: 0.9em;
	}

	.list a:hover {
		background: var(--surface-2);
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--danger);
		flex: none;
		align-self: center;
	}

	.dot.won {
		background: var(--ok);
	}
</style>
