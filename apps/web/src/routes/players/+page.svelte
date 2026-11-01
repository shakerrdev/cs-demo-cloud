<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let query = $state('');
	const shown = $derived(
		data.players.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
	);
</script>

<svelte:head><title>Players · cs-demo-cloud</title></svelte:head>

<div class="heading">
	<h1>Players</h1>
	<input type="search" placeholder="Find a player" bind:value={query} aria-label="Find a player" />
</div>

{#if !data.players.length}
	<p class="empty">Players show up here once a demo has been parsed.</p>
{:else}
	<ul class="players">
		{#each shown as player (player.steamid)}
			<li>
				<a href="/players/{player.steamid}">
					<span class="name">{player.name}</span>
					<span class="meta"
						>{player.matches}
						{player.matches === 1 ? 'match' : 'matches'} · K/D {(
							player.kills / Math.max(1, player.deaths)
						).toFixed(2)}</span
					>
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

	input {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 7px 10px;
		min-width: 220px;
	}

	.players {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 8px;
	}

	.players a {
		display: grid;
		gap: 2px;
		padding: 12px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: inherit;
		text-decoration: none;
	}

	.players a:hover {
		border-color: var(--muted);
	}

	.name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta,
	.empty {
		color: var(--muted);
		font-size: 0.9em;
	}
</style>
