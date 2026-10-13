<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { mapTitle } from '@cs-demo-cloud/replay';
	import Uploader from '#lib/components/Uploader.svelte';
	import { formatBytes, formatDate, formatDuration, platformName } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const busy = $derived(
		data.demos.some(({ demo }) => demo.status === 'queued' || demo.status === 'processing')
	);

	$effect(() => {
		if (!busy) return;
		const timer = setInterval(() => invalidateAll(), 2000);
		return () => clearInterval(timer);
	});

	const statusText = { queued: 'Queued', processing: 'Parsing…', ready: 'Ready', failed: 'Failed' };
</script>

<Uploader />

<h1>Matches</h1>

{#if data.demos.length === 0}
	<p class="empty">No demos yet. Drop a few .dem files here to get started.</p>
{:else}
	<ul class="matches">
		{#each data.demos as { demo, match } (demo.id)}
			{@const ready = demo.status === 'ready' && match}
			<li>
				<a href={ready ? `/demos/${demo.id}` : undefined} class:disabled={!ready}>
					<span class="thumb">
						{#if match}
							<img
								src="/maps/{match.map}.png"
								alt=""
								loading="lazy"
								onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
							/>
						{/if}
					</span>
					<span class="main">
						<span class="title">{match ? mapTitle(match.map) : demo.fileName}</span>
						<span class="meta">
							{#if match}
								{platformName(match.platform)} · {formatDuration(match.durationSeconds)} ·
							{/if}
							{formatDate(demo.fileModifiedAt ?? demo.createdAt)}
							{#if !match}· {formatBytes(demo.fileSize)}{/if}
						</span>
					</span>
					{#if match}
						<span class="score">
							<span class:win={match.scoreA > match.scoreB}>{match.scoreA}</span>
							<span class="sep">:</span>
							<span class:win={match.scoreB > match.scoreA}>{match.scoreB}</span>
						</span>
					{:else}
						<span class="status {demo.status}" title={demo.error ?? undefined}>
							{statusText[demo.status]}
						</span>
					{/if}
				</a>
				{#if demo.status === 'failed' && demo.error}
					<p class="error">{demo.error}</p>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	h1 {
		margin: 32px 0 14px;
		font-size: 20px;
		font-weight: 650;
	}

	.empty {
		padding: 40px;
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--muted);
		text-align: center;
	}

	.matches {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	a {
		display: grid;
		grid-template-columns: 56px minmax(0, 1fr) auto;
		align-items: center;
		gap: 16px;
		padding: 10px 18px 10px 10px;
		border: 1px solid transparent;
		border-radius: var(--radius);
		background: var(--surface);
		text-decoration: none;
	}

	a[href]:hover {
		border-color: var(--border);
		background: var(--surface-2);
	}

	a.disabled {
		cursor: default;
	}

	.thumb {
		width: 56px;
		height: 56px;
		border-radius: 8px;
		background: var(--surface-2);
		overflow: hidden;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.main {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.title {
		font-weight: 650;
		font-size: 16px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		color: var(--muted);
		font-size: 13px;
	}

	.score {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font-size: 22px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}

	.score .win {
		color: var(--text);
	}

	.sep {
		font-size: 16px;
	}

	.status {
		padding: 3px 10px;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--muted);
		font-size: 12px;
		font-weight: 600;
	}

	.status.processing {
		color: var(--warn);
	}

	.status.failed {
		color: var(--danger);
	}

	.error {
		margin: 4px 0 0 82px;
		color: var(--danger);
		font-size: 13px;
	}
</style>
