<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatBytes, formatDate } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const admin = $derived(data.user?.role === 'admin');
	let copied = $state(false);
	type PackResult = { name: string; ok: boolean; text: string };
	let packUpload = $state<{
		name: string;
		index: number;
		count: number;
		loaded: number;
		total: number;
	} | null>(null);
	let packResults = $state<PackResult[]>([]);
	let packInput = $state<HTMLInputElement>();

	const PACK_LABELS: Record<string, string> = {
		players: 'Player models',
		sounds: 'Sounds',
		skins: 'Weapon and glove skins',
		agents: 'Agents'
	};
	const PACK_ORDER = Object.keys(PACK_LABELS);
	const packs = $derived(
		[...data.mapPacks].sort((a, b) => {
			const ai = PACK_ORDER.indexOf(a.map);
			const bi = PACK_ORDER.indexOf(b.map);
			if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
			return a.map.localeCompare(b.map);
		})
	);

	function sendPack(file: File, index: number, count: number): Promise<PackResult> {
		packUpload = { name: file.name, index, count, loaded: 0, total: file.size };
		return new Promise((resolve) => {
			const request = new XMLHttpRequest();
			request.open('POST', '/api/maps');
			request.setRequestHeader('content-type', 'application/octet-stream');
			request.upload.onprogress = (event) => {
				if (packUpload) packUpload.loaded = event.loaded;
			};
			request.onload = () => {
				if (request.status === 201) {
					const installed = JSON.parse(request.responseText) as { map: string }[];
					const names = installed.map((pack) => PACK_LABELS[pack.map] ?? pack.map);
					resolve({ name: file.name, ok: true, text: `${names.join(', ')} ready` });
				} else {
					let text = `Server answered ${request.status}`;
					try {
						text = (JSON.parse(request.responseText) as { message?: string }).message ?? text;
					} catch {}
					resolve({ name: file.name, ok: false, text });
				}
			};
			request.onerror = () => resolve({ name: file.name, ok: false, text: 'Connection lost' });
			request.send(file);
		});
	}

	async function uploadPacks(files: File[]) {
		packResults = [];
		for (const [index, file] of files.entries()) {
			const result = await sendPack(file, index + 1, files.length);
			packResults = [...packResults, result];
			if (result.ok) await invalidateAll();
		}
		packUpload = null;
	}

	async function removePack(map: string) {
		const question = PACK_LABELS[map]
			? `Remove ${PACK_LABELS[map]}?`
			: `Remove the 3D map for ${map}? Matches on it fall back to the simple 3D view.`;
		if (!confirm(question)) return;
		const response = await fetch(`/api/maps/${map}`, { method: 'DELETE' });
		if (!response.ok)
			packResults = [{ name: map, ok: false, text: `Could not remove ${PACK_LABELS[map] ?? map}` }];
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

{#if data.tls.mode === 'local-ca'}
	<section class="panel">
		<h2>HTTPS</h2>
		<p class="hint">
			This server signs its own certificates. Install its certificate authority once on each device
			and the browser stops warning. Check that the fingerprint matches when you install it.
		</p>
		<div class="row">
			<a class="button primary" href="/ca.crt" download>Download certificate</a>
			<span class="muted"
				>{data.tls.name} · valid until {formatDate(new Date(data.tls.expires))}</span
			>
		</div>
		<p class="fingerprint">
			<span class="muted">SHA-256</span> <code>{data.tls.fingerprint}</code>
		</p>
		<details>
			<summary>How to install it</summary>
			<ul class="steps">
				<li>
					<strong>Windows (Chrome, Edge, Firefox, Zen):</strong> open the downloaded file → Install Certificate
					→ Current User → Place all certificates in the following store → Browse → Trusted Root Certification
					Authorities → Finish. Restart the browser.
				</li>
				<li>
					<strong>Firefox or Zen if it still warns:</strong> Settings → Privacy &amp; Security → Certificates
					→ View Certificates → Authorities → Import, then tick “Trust this CA to identify websites”.
				</li>
				<li>
					<strong>macOS:</strong> open the file, add it to the System keychain, then in Keychain Access
					open it and set Trust → Always Trust.
				</li>
				<li>
					<strong>Android:</strong> Settings → Security → Encryption &amp; credentials → Install a certificate
					→ CA certificate.
				</li>
				<li>
					<strong>iPhone/iPad:</strong> open the file in Safari, install the profile in Settings, then
					enable it under General → About → Certificate Trust Settings.
				</li>
			</ul>
			<p class="hint">
				Names like <code>obelix</code> or <code>nas.local</code> work automatically. To open the app
				by IP address, add the address to <code>TLS_HOSTS</code> in the compose file.
			</p>
		</details>
	</section>
{/if}

<section class="panel">
	<h2>API tokens</h2>
	<p class="hint">
		Let scripts and browser extensions upload demos as you, for example from FACEIT. Send the token
		as <code>Authorization: Bearer …</code> (see the README).
	</p>
	<form method="POST" action="?/token" class="row">
		<input
			name="name"
			placeholder="What is it for?"
			maxlength="48"
			required
			aria-label="Token name"
		/>
		<button type="submit" class="primary">Create token</button>
	</form>
	{#if form?.action === 'token' && form.token}
		<div class="link">
			<input
				readonly
				value={form.token}
				aria-label="New API token"
				onfocus={(e) => e.currentTarget.select()}
			/>
			<button type="button" onclick={() => copy(form.token!)}>{copied ? 'Copied' : 'Copy'}</button>
		</div>
		<p class="hint">Copy it now. It isn’t shown again.</p>
	{:else if form?.action === 'token' && form.message}
		<p class="form-error">{form.message}</p>
	{/if}
	{#if data.tokens.length}
		<ul class="list">
			{#each data.tokens as token (token.id)}
				<li>
					<span>{token.name} <span class="muted">…{token.hint}</span></span>
					<span class="muted"
						>created {formatDate(token.createdAt)} · {token.lastUsedAt
							? `last used ${formatDate(token.lastUsedAt)}`
							: 'never used'}</span
					>
					<form
						method="POST"
						action="?/revokeToken"
						onsubmit={(e) => {
							if (!confirm(`Revoke ${token.name}? Anything using it stops working.`))
								e.preventDefault();
						}}
					>
						<input type="hidden" name="id" value={token.id} />
						<button type="submit" class="small danger">Revoke</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
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
			Maps with textures, lighting and sky, player models, sounds, skins and agents for the 3D view.
			Make the packs on a PC with CS2 using the map exporter (see the README), then add the zips
			here; you can pick several at once. The skins and agents packs hold what your demos use: give
			the exporter
			<a href="/api/cosmetics?download">this list</a> or an API token.
		</p>
		{#if packs.length}
			<ul class="list">
				{#each packs as pack (pack.map)}
					<li>
						<span>{PACK_LABELS[pack.map] ?? pack.map}</span>
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
				multiple
				hidden
				onchange={(e) => {
					const files = [...(e.currentTarget.files ?? [])];
					e.currentTarget.value = '';
					if (files.length) void uploadPacks(files);
				}}
			/>
			<button
				type="button"
				class="primary"
				disabled={!!packUpload}
				onclick={() => packInput?.click()}>Add packs</button
			>
			{#if packUpload}
				<span class="muted" role="status"
					>{packUpload.count > 1
						? `${packUpload.index}/${packUpload.count} · `
						: ''}{packUpload.loaded < packUpload.total
						? `Uploading ${packUpload.name} · ${Math.floor((packUpload.loaded / packUpload.total) * 100)} %`
						: `Unpacking ${packUpload.name}…`}</span
				>
			{/if}
		</div>
		{#if packResults.length}
			<ul class="results" role="status">
				{#each packResults as result, i (i)}
					<li class:form-error={!result.ok} class:form-ok={result.ok}>
						{result.name}: {result.text}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.results {
		margin: 10px 0 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 4px;
		font-size: 0.9em;
	}
	.fingerprint {
		margin: 12px 0 0;
		font-size: 13px;
		overflow-wrap: anywhere;
	}

	details {
		margin-top: 12px;
	}

	summary {
		cursor: pointer;
		font-weight: 600;
	}

	.steps {
		margin: 10px 0;
		padding-left: 18px;
		display: grid;
		gap: 8px;
		font-size: 14px;
		line-height: 1.45;
	}
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
