<script lang="ts">
	import { formatDate } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let query = $state('');
	type SortKey = 'matches' | 'kd' | 'adr' | 'hs' | 'win' | 'last' | 'name';
	let sort = $state<SortKey>('matches');

	const rows = $derived(
		data.players.map((p) => ({
			...p,
			kd: p.kills / Math.max(1, p.deaths),
			adr: p.damage / Math.max(1, p.rounds),
			hs: p.kills ? p.headshotKills / p.kills : 0,
			win: p.matches ? p.wins / p.matches : 0
		}))
	);
	const shown = $derived(
		rows
			.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
			.sort((a, b) => {
				const byName = a.name.localeCompare(b.name, undefined, { numeric: true });
				if (sort === 'name') return byName;
				if (sort === 'last') return b.lastPlayed.getTime() - a.lastPlayed.getTime() || byName;
				return b[sort] - a[sort] || b.matches - a.matches || byName;
			})
	);
	const columns: { key: SortKey; label: string }[] = [
		{ key: 'matches', label: 'Matches' },
		{ key: 'win', label: 'Win rate' },
		{ key: 'kd', label: 'K/D' },
		{ key: 'adr', label: 'ADR' },
		{ key: 'hs', label: 'HS%' },
		{ key: 'last', label: 'Last played' }
	];
</script>

<svelte:head><title>Players · cs-demo-cloud</title></svelte:head>

<div class="heading">
	<h1>Players</h1>
	<input type="search" placeholder="Find a player" bind:value={query} aria-label="Find a player" />
</div>

{#if !data.players.length}
	<p class="empty">Players show up here once a demo has been parsed.</p>
{:else}
	<div class="table">
		<table>
			<thead>
				<tr>
					<th class="name">
						<button type="button" class:on={sort === 'name'} onclick={() => (sort = 'name')}
							>Player</button
						>
					</th>
					{#each columns as column (column.key)}
						<th>
							<button
								type="button"
								class:on={sort === column.key}
								onclick={() => (sort = column.key)}>{column.label}</button
							>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each shown as p (p.steamid)}
					<tr>
						<td class="name"
							><a href="/players/{p.steamid}">{p.name}</a>{#if p.steamid === data.ownSteamId}<span
									class="you">you</span
								>{/if}</td
						>
						<td>{p.matches}</td>
						<td>{Math.round(p.win * 100)}%</td>
						<td class:pos={p.kd >= 1.1} class:neg={p.kd < 0.9}>{p.kd.toFixed(2)}</td>
						<td>{Math.round(p.adr)}</td>
						<td>{Math.round(p.hs * 100)}%</td>
						<td class="date">{formatDate(p.lastPlayed)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
	}

	h1 {
		margin: 0;
		font-size: 1.5rem;
	}

	input {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 7px 10px;
		min-width: 220px;
	}

	.table {
		overflow-x: auto;
		background: var(--surface);
		border-radius: var(--radius);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}

	th,
	td {
		padding: 9px 14px;
		text-align: right;
		white-space: nowrap;
	}

	th.name,
	td.name {
		text-align: left;
	}

	th button {
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font: inherit;
		font-size: 0.85em;
		font-weight: 600;
		cursor: pointer;
	}

	th button.on {
		color: var(--text);
	}

	th button.on::after {
		content: ' ↓';
	}

	tbody tr {
		border-top: 1px solid var(--border);
	}

	tbody tr:hover {
		background: var(--surface-2);
	}

	td.name a {
		color: inherit;
		font-weight: 600;
		text-decoration: none;
	}

	td.name a:hover {
		text-decoration: underline;
	}

	.you {
		margin-left: 8px;
		padding: 1px 6px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 22%, transparent);
		color: var(--accent);
		font-size: 0.75em;
		font-weight: 700;
	}

	.date,
	.empty {
		color: var(--muted);
	}

	.pos {
		color: var(--ok);
	}

	.neg {
		color: var(--danger);
	}
</style>
