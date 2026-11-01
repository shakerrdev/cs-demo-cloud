<script lang="ts">
	import { enhance } from '$app/forms';
	import { mapTitle } from '@cs-demo-cloud/replay';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const playlist = $derived(data.playlist);
	let renaming = $state(false);
	let confirmDelete = $state(false);

	const watch = (index: number) => {
		const item = playlist.items[index]!;
		return `/demos/${item.demoId}?playlist=${playlist.id}&item=${index}#round-${item.round}@${item.tick}`;
	};
</script>

<svelte:head><title>{playlist.name} · Playlists · cs-demo-cloud</title></svelte:head>

<header class="head">
	{#if renaming}
		<form
			method="POST"
			action="?/rename"
			class="rename"
			use:enhance={() =>
				async ({ update }) => {
					await update({ reset: false });
					renaming = false;
				}}
		>
			<input name="name" value={playlist.name} maxlength="80" required aria-label="Name" />
			<button type="submit" class="button small">Save</button>
			<button type="button" class="button small" onclick={() => (renaming = false)}>Cancel</button>
		</form>
	{:else}
		<h1>{playlist.name}</h1>
	{/if}
	<div class="tools">
		{#if playlist.items.length}
			<a class="button small primary" href={watch(0)} data-sveltekit-reload>Play from the start</a>
		{/if}
		<button type="button" class="button small" onclick={() => (renaming = true)}>Rename</button>
		{#if confirmDelete}
			<form method="POST" action="?/delete">
				<button type="submit" class="button small danger">Delete playlist</button>
			</form>
			<button type="button" class="button small" onclick={() => (confirmDelete = false)}
				>Keep it</button
			>
		{:else}
			<button type="button" class="button small" onclick={() => (confirmDelete = true)}
				>Delete</button
			>
		{/if}
	</div>
</header>
{#if form?.message}<p class="error">{form.message}</p>{/if}

{#if !playlist.items.length}
	<p class="empty">
		Nothing here yet. Open a match, pause on a moment and press <b>B</b> to add it.
	</p>
{:else}
	<ol class="items">
		{#each playlist.items as item, index (item.id)}
			<li>
				<a class="play" href={watch(index)} data-sveltekit-reload>
					<img
						src="/maps/{item.map}.png"
						alt=""
						loading="lazy"
						onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
					/>
					<span class="where">
						<b
							>{item.map ? mapTitle(item.map) : item.fileName}{item.scoreA !== null
								? ` ${item.scoreA}:${item.scoreB}`
								: ''}</b
						>
						<small>Round {item.round}{item.createdBy ? ` · added by ${item.createdBy}` : ''}</small>
					</span>
				</a>
				<form
					method="POST"
					action="?/note"
					class="note"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
				>
					<input type="hidden" name="id" value={item.id} />
					<input
						name="note"
						value={item.note}
						placeholder="Add a note"
						maxlength="500"
						aria-label="Note"
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
					/>
				</form>
				<form method="POST" action="?/remove" use:enhance>
					<input type="hidden" name="id" value={item.id} />
					<button type="submit" class="remove" aria-label="Remove from playlist" title="Remove"
						>×</button
					>
				</form>
			</li>
		{/each}
	</ol>
{/if}

<style>
	.head {
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

	.tools,
	.rename {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}

	.rename input,
	.note input {
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 6px 10px;
		font: inherit;
	}

	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}

	.items li {
		display: grid;
		grid-template-columns: minmax(180px, 280px) minmax(0, 1fr) auto;
		align-items: center;
		gap: 12px;
		padding: 8px 10px;
		border-radius: var(--radius);
		background: var(--surface);
	}

	@media (max-width: 640px) {
		.items li {
			grid-template-columns: 1fr auto;
		}

		.note {
			grid-column: 1 / -1;
			grid-row: 2;
		}
	}

	.play {
		display: flex;
		align-items: center;
		gap: 10px;
		color: inherit;
		text-decoration: none;
	}

	.play:hover b {
		color: var(--accent);
	}

	.play img {
		width: 40px;
		height: 40px;
		border-radius: 6px;
		object-fit: cover;
		background: var(--surface-2);
	}

	.where {
		display: grid;
	}

	small,
	.empty {
		color: var(--muted);
	}

	.note input {
		width: 100%;
	}

	.remove {
		width: 30px;
		height: 30px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--muted);
		font-size: 18px;
		cursor: pointer;
	}

	.remove:hover {
		background: var(--surface-2);
		color: var(--danger);
	}

	.error {
		color: var(--danger);
	}
</style>
