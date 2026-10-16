<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatBytes, formatDate } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const admin = $derived(data.user?.role === 'admin');
	let copied = $state(false);
	let packUpload = $state<{ name: string; loaded: number; total: number } | null>(null);
	let packMessage = $state<{ ok: boolean; text: string } | null>(null);
	let packInput = $state<HTMLInputElement>();

	function uploadPack(file: File) {
		packMessage = null;
		packUpload = { name: file.name, loaded: 0, total: file.size };
		const request = new XMLHttpRequest();
		request.open('POST', '/api/maps');
		request.setRequestHeader('content-type', 'application/octet-stream');
		request.upload.onprogress = (event) => {
			if (packUpload) packUpload.loaded = event.loaded;
		};
		request.onload = async () => {
			packUpload = null;
			if (request.status === 201) {
				const pack = JSON.parse(request.responseText) as { map: string };
				packMessage = { ok: true, text: `${pack.map} is ready in 3D` };
				await invalidateAll();
			} else {
				let text = `Server answered ${request.status}`;
				try {
					text = (JSON.parse(request.responseText) as { message?: string }).message ?? text;
				} catch {}
				packMessage = { ok: false, text };
			}
		};
		request.onerror = () => {
			packUpload = null;
			packMessage = { ok: false, text: 'Connection lost' };
		};
		request.send(file);
	}

	async function removePack(map: string) {
		if (!confirm(`Remove the 3D map for ${map}? Matches on it fall back to the simple 3D view.`))
			return;
		const response = await fetch(`/api/maps/${map}`, { method: 'DELETE' });
		if (!response.ok) packMessage = { ok: false, text: `Could not remove ${map}` };
		await invalidateAll();
	}

	async function copy(link: string) {
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			copied = false;
		}
	}
</script>

<svelte:head>
	<title>Settings · cs-demo-cloud</title>
</svelte:head>

<h1>Settings</h1>

<section class="panel">
	<h2>Your password</h2>
	<form method="POST" action="?/password" class="grid">
		<label>
			Current password
			<input name="current" type="password" autocomplete="current-password" required />
		</label>
		<label>
			New password
			<input name="next" type="password" autocomplete="new-password" required minlength="10" />
		</label>
		<label>
			Repeat new password
			<input name="confirm" type="password" autocomplete="new-password" required minlength="10" />
		</label>
		<div class="row">
			<button type="submit">Change password</button>
			{#if form?.action === 'password' && form.message}
				<span class:form-error={!form.ok} class:form-ok={form.ok} role="status">{form.message}</span
				>
			{/if}
		</div>
	</form>
</section>

{#if admin}
	<section class="panel">
		<h2>Invite someone</h2>
		<p class="hint">
			Invite links work once and expire after 7 days. Everyone shares the same match library.
		</p>
		<form method="POST" action="?/invite" class="row">
			<select name="role" aria-label="Role">
				<option value="member">Member</option>
				<option value="admin">Admin (can invite and remove people)</option>
			</select>
			<button type="submit" class="primary">Create invite link</button>
		</form>
		{#if form?.action === 'invite' && form.link}
			<div class="link">
				<input
					readonly
					value={form.link}
					aria-label="Invite link"
					onfocus={(e) => e.currentTarget.select()}
				/>
				<button type="button" onclick={() => copy(form.link!)}>{copied ? 'Copied' : 'Copy'}</button>
			</div>
			<p class="hint">Send this link now. It isn’t shown again.</p>
		{/if}

		{#if data.invites.length}
			<h3>Open invites</h3>
			<ul class="list">
				{#each data.invites as invite (invite.id)}
					<li>
						<span
							>{invite.role === 'admin' ? 'Admin' : 'Member'} invite{invite.createdBy
								? ` by ${invite.createdBy}`
								: ''}</span
						>
						<span class="muted">expires {formatDate(invite.expiresAt)}</span>
						<form method="POST" action="?/revoke">
							<input type="hidden" name="id" value={invite.id} />
							<button type="submit" class="small">Revoke</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="panel">
		<h2>People</h2>
		<ul class="list">
			{#each data.users as user (user.id)}
				<li>
					<span>{user.name}{user.id === data.user?.id ? ' (you)' : ''}</span>
					<span class="muted"
						>{user.role} · {user.uploads} uploads · joined {formatDate(user.createdAt)}</span
					>
					{#if user.id !== data.user?.id}
						<form
							method="POST"
							action="?/remove"
							onsubmit={(e) => {
								if (!confirm(`Remove ${user.name}? Their uploads stay.`)) e.preventDefault();
							}}
						>
							<input type="hidden" name="id" value={user.id} />
							<button type="submit" class="small danger">Remove</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
		{#if form?.action === 'remove' && form.message}<p class="form-error">{form.message}</p>{/if}
	</section>

	<section class="panel">
		<h2>3D maps</h2>
		<p class="hint">
			Maps with textures, lighting and sky, and player models for the 3D view. Make the packs on a
			PC with CS2 using the map exporter (see the README), then add the zips here.
		</p>
		{#if data.mapPacks.length}
			<ul class="list">
				{#each data.mapPacks as pack (pack.map)}
					<li>
						<span>{pack.map === 'players' ? 'Player models' : pack.map}</span>
						<span class="muted"
							>{formatBytes(pack.bytes)} · game {pack.build ?? 'unknown'} · exported {formatDate(
								new Date(pack.exportedAt)
							)}</span
						>
						<button type="button" class="small danger" onclick={() => removePack(pack.map)}
							>Remove</button
						>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="row">
			<input
				bind:this={packInput}
				type="file"
				accept=".zip,application/zip"
				hidden
				onchange={(e) => {
					const file = e.currentTarget.files?.[0];
					if (file) uploadPack(file);
					e.currentTarget.value = '';
				}}
			/>
			<button
				type="button"
				class="primary"
				disabled={!!packUpload}
				onclick={() => packInput?.click()}>Add pack</button
			>
			{#if packUpload}
				<span class="muted" role="status"
					>{packUpload.loaded < packUpload.total
						? `Uploading ${packUpload.name} · ${Math.floor((packUpload.loaded / packUpload.total) * 100)} %`
						: `Unpacking ${packUpload.name}…`}</span
				>
			{:else if packMessage}
				<span class:form-error={!packMessage.ok} class:form-ok={packMessage.ok} role="status"
					>{packMessage.text}</span
				>
			{/if}
		</div>
	</section>
{/if}

<style>
	h1 {
		margin: 0 0 18px;
		font-size: 22px;
	}

	.panel {
		display: grid;
		gap: 12px;
		max-width: 720px;
		margin-bottom: 18px;
		padding: 20px;
		border-radius: var(--radius);
		background: var(--surface);
	}

	h2 {
		margin: 0;
		font-size: 16px;
	}

	h3 {
		margin: 8px 0 0;
		color: var(--muted);
		font-size: 13px;
		font-weight: 600;
	}

	.grid {
		display: grid;
		gap: 12px;
		max-width: 360px;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.link {
		display: flex;
		gap: 8px;
	}

	.link input {
		flex: 1;
		font-family: ui-monospace, monospace;
		font-size: 13px;
	}

	.list {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 14px;
		padding: 8px 12px;
		border-radius: 8px;
		background: var(--surface-2);
	}

	.list li form,
	.list li > button {
		margin-left: auto;
	}

	.muted {
		color: var(--muted);
		font-size: 13px;
	}
</style>
