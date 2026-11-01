<script lang="ts">
	import type { RoundReplay } from '@cs-demo-cloud/replay';
	import { placeName } from '#lib/format.ts';
	import { placesAt } from '#lib/viewer/frame.ts';
	import { loadRound } from '#lib/viewer/loader.ts';
	import type { StackEntry } from './RoundStack.svelte';

	interface Props {
		entries: StackEntry[];
		steamid: string;
	}

	let { entries, steamid }: Props = $props();

	const moments = [5, 15, 25, 40, 60];
	let replays = $state.raw<RoundReplay[]>([]);

	$effect(() => {
		const list = entries;
		let cancelled = false;
		Promise.all(
			list.map((entry) => loadRound(entry.demoId, entry.version, entry.round).catch(() => null))
		).then((loaded) => {
			if (!cancelled) replays = loaded.filter((replay) => replay !== null);
		});
		return () => {
			cancelled = true;
		};
	});

	const columns = $derived.by(() => {
		const counts = moments.map(() => new Map<string, number>());
		const totals = moments.map(() => 0);
		for (const replay of replays) {
			placesAt(replay, steamid, moments).forEach((place, i) => {
				if (place === null) return;
				counts[i]!.set(place, (counts[i]!.get(place) ?? 0) + 1);
				totals[i]!++;
			});
		}
		return moments.map((second, i) => ({
			second,
			total: totals[i]!,
			top: [...counts[i]!]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 4)
				.map(([place, count]) => ({ place, share: count / totals[i]! }))
		}));
	});
	const known = $derived(columns.some((column) => column.top.some((t) => t.place !== 'Dead')));
</script>

{#if replays.length && known}
	<section class="places" aria-label="Where the player usually is">
		<h2>Usual positions</h2>
		<div class="grid">
			{#each columns as column (column.second)}
				<div class="column">
					<h3>+{column.second} s</h3>
					{#if !column.top.length}
						<p class="none">Round over</p>
					{:else}
						<ol>
							{#each column.top as item (item.place)}
								<li class:dead={item.place === 'Dead'}>
									<span class="bar" style:width="{Math.round(item.share * 100)}%"></span>
									<span class="name">{item.place === 'Dead' ? 'Dead' : placeName(item.place)}</span>
									<b>{Math.round(item.share * 100)}%</b>
								</li>
							{/each}
						</ol>
					{/if}
				</div>
			{/each}
		</div>
	</section>
{/if}

<style>
	.places {
		margin-top: 16px;
		background: var(--surface);
		border-radius: var(--radius);
		padding: 14px 16px;
	}

	h2 {
		margin: 0 0 10px;
		font-size: 1rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 14px;
	}

	h3 {
		margin: 0 0 6px;
		font-size: 0.8rem;
		color: var(--muted);
		font-weight: 600;
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}

	li {
		position: relative;
		display: flex;
		justify-content: space-between;
		gap: 8px;
		padding: 3px 6px;
		border-radius: 4px;
		font-size: 0.88em;
		overflow: hidden;
	}

	.bar {
		position: absolute;
		inset: 0 auto 0 0;
		background: color-mix(in srgb, var(--accent) 22%, transparent);
		z-index: 0;
	}

	li.dead .bar {
		background: color-mix(in srgb, var(--danger) 18%, transparent);
	}

	.name,
	b {
		position: relative;
		z-index: 1;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	b {
		font-variant-numeric: tabular-nums;
	}

	.none {
		margin: 0;
		color: var(--muted);
		font-size: 0.88em;
	}
</style>
