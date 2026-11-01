<script lang="ts">
	import { formatDate } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Playlists · cs-demo-cloud</title></svelte:head>

<div class="heading">
	<h1>Playlists</h1>
	<form method="POST" action="?/create" class="create">
		<input name="name" placeholder="New playlist" maxlength="80" required aria-label="Name" />
		<button type="submit" class="button small">Create</button>
	</form>
</div>
{#if form?.message}<p class="error">{form.message}</p>{/if}

{#if !data.playlists.length}
	<p class="empty">
		No playlists yet. While watching a demo, press <b>B</b> or <b>Bookmark</b> to save a moment with a
		note; moments collect in playlists you can step through later, across matches.
	</p>
{:else}
	<ul class="lists">
		{#each data.playlists as list (list.id)}
			<li>
				<a href="/playlists/{list.id}">
					<span class="name">{list.name}</span>
					<span class="meta"
						>{list.count}
						{list.count === 1 ? 'moment' : 'moments'} · {formatDate(list.createdAt)}{list.createdBy
							? ` · ${list.createdBy}`
							: ''}</span
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

	.create {
		display: flex;
		gap: 8px;
	}

	.create input {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 6px 10px;
	}

	.lists {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.lists a {
		display: grid;
		gap: 2px;
		padding: 12px 14px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		color: inherit;
		text-decoration: none;
	}

	.lists a:hover {
		border-color: var(--muted);
	}

	.name {
		font-weight: 600;
	}

	.meta,
	.empty {
		color: var(--muted);
	}

	.error {
		color: var(--danger);
	}
</style>
