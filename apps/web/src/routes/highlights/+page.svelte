<script lang="ts">
	import { mapTitle } from '@cs-demo-cloud/replay';
	import { formatDate } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let kind = $state<'all' | 'multi' | 'clutch'>('all');
	let min = $state(3);
	let player = $state('');

	const people = $derived(
		[...new Map(data.items.map((item) => [item.steamid, item.name])).entries()].sort((a, b) =>
			a[1].localeCompare(b[1])
		)
	);
	const shown = $derived(
		data.items.filter((item) => {
			if (kind !== 'all' && item.kind !== kind) return false;
			if (player && item.steamid !== player) return false;
			return item.kind === 'multi' ? item.size >= min : item.size >= Math.max(2, min - 2);
		})
	);
	const label = (item: (typeof data.items)[number]) =>
		item.kind === 'multi' ? (item.size >= 5 ? 'ACE' : `${item.size}K`) : `1v${item.size}`;
</script>

<svelte:head><title>Highlights · cs-demo-cloud</title></svelte:head>

<div class="heading">
	<h1>Highlights</h1>
	<div class="filters">
		<div class="toggle" role="group" aria-label="Kind">
			{#each [['all', 'All'], ['multi', 'Multi-kills'], ['clutch', 'Clutches']] as [key, text] (key)}
				<button
					type="button"
					aria-pressed={kind === key}
					onclick={() => (kind = key as typeof kind)}>{text}</button
				>
			{/each}
		</div>
		<select bind:value={min} aria-label="At least">
			<option value={3}>3K / 1v2 and up</option>
			<option value={4}>4K / 1v2 and up</option>
			<option value={5}>Aces / 1v3 and up</option>
		</select>
		<select bind:value={player} aria-label="Player">
			<option value="">Everyone</option>
			{#each people as [steamid, name] (steamid)}
				<option value={steamid}>{name}</option>
			{/each}
		</select>
	</div>
</div>

{#if shown.length}
	<form method="POST" action="?/save" class="save">
		{#each shown as item (item.demoId + item.round + item.steamid + item.kind)}
			<input
				type="hidden"
				name="item"
				value="{item.demoId}/{item.round}/{item.steamid}/{item.kind}"
			/>
		{/each}
		<input
			name="name"
			placeholder="Playlist name"
			maxlength="80"
			value="Highlights"
			aria-label="Playlist name"
		/>
		<button type="submit" class="button small">Save {shown.length} as a playlist</button>
	</form>
{/if}

{#if !shown.length}
	<p class="empty">No highlights yet{data.items.length ? ' for these filters' : ''}.</p>
{:else}
	<ul class="list">
		{#each shown as item (item.demoId + item.round + item.steamid + item.kind)}
			<li>
				<a
					href="/demos/{item.demoId}#round-{item.round}@{Math.max(
						0,
						item.tick - 3 * item.tickRate
					)}"
				>
					<span
						class="badge {item.kind}"
						class:big={item.kind === 'multi' ? item.size >= 4 : item.size >= 3}>{label(item)}</span
					>
					<span class="who">{item.name}</span>
					<span class="where"
						>{mapTitle(item.map)} · round {item.round} · {formatDate(item.playedAt)}</span
					>
					<span class="watch">Watch ›</span>
				</a>
			</li>
		{/each}
	</ul>
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

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
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

	.save {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
		margin-bottom: 10px;
	}

	.save input {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 5px 8px;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}

	.list a {
		display: grid;
		grid-template-columns: 64px minmax(0, 180px) minmax(0, 1fr) auto;
		align-items: center;
		gap: 14px;
		padding: 10px 14px;
		border-radius: var(--radius);
		background: var(--surface);
		color: inherit;
		text-decoration: none;
	}

	.list a:hover {
		background: var(--surface-2);
	}

	.badge {
		text-align: center;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		padding: 3px 0;
		border-radius: 6px;
		background: var(--surface-2);
	}

	.badge.big {
		background: color-mix(in srgb, var(--accent) 22%, transparent);
		color: var(--accent);
	}

	.who {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.where,
	.empty {
		color: var(--muted);
	}

	.where {
		font-size: 0.9em;
	}

	.watch {
		color: var(--muted);
		font-size: 0.9em;
	}

	@media (max-width: 640px) {
		.list a {
			grid-template-columns: 56px minmax(0, 1fr) auto;
		}

		.where {
			grid-column: 2 / -1;
			grid-row: 2;
		}
	}
</style>
