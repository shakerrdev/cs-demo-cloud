<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatDate } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let editing = $state(false);

	const login = $derived(data.admin?.login ?? null);
	const working = $derived(
		login?.step === 'confirm' ||
			data.recent.some(
				(m) => m.status === 'pending' || m.demoStatus === 'queued' || m.demoStatus === 'processing'
			)
	);

	$effect(() => {
		if (!working) return;
		const timer = setInterval(() => invalidateAll(), 3000);
		return () => clearInterval(timer);
	});

	$effect(() => {
		if (form?.action === 'link' && form.ok) editing = false;
	});

	const ago = (value: Date | number | null) => {
		if (!value) return 'never';
		const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes} min ago`;
		return formatDate(new Date(value));
	};

	function statusOf(match: (typeof data.recent)[number]) {
		if (match.status === 'done') {
			if (match.demoStatus === 'ready') return { label: 'Imported', tone: 'ok' };
			if (match.demoStatus === 'failed') return { label: 'Parse failed', tone: 'bad' };
			return { label: 'Parsing…', tone: 'busy' };
		}
		if (match.status === 'pending') {
			return {
				label: match.attempts > 0 ? `Retrying (${match.attempts})` : 'Waiting',
				tone: 'busy'
			};
		}
		if (match.status === 'unavailable') return { label: 'Not available', tone: 'muted' };
		return { label: 'Failed', tone: 'bad' };
	}

	const helpUrl =
		'https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128';
</script>

<svelte:head>
	<title>Auto-import · cs-demo-cloud</title>
</svelte:head>

<header class="top">
	<div>
		<h1>Auto-import from Valve</h1>
		<p class="hint">
			New Premier, Competitive and Wingman matches are downloaded and parsed automatically. Last
			check {ago(data.status.lastRunAt)}.
		</p>
	</div>
	<form method="POST" action="?/check">
		<button type="submit">Check now</button>
	</form>
</header>

{#if !data.ready.apiKey || !data.ready.bot}
	<p class="notice">
		{#if data.admin}
			Finish the Steam setup below ({[
				!data.ready.apiKey && 'Web API key',
				!data.ready.bot && 'bot account'
			]
				.filter(Boolean)
				.join(' and ')}) to start importing.
		{:else}
			An admin still needs to finish the Steam setup before matches can be imported.
		{/if}
	</p>
{/if}
{#if data.status.lastError || (data.ready.bot && data.status.botError)}
	<p class="notice bad">{(data.ready.bot && data.status.botError) || data.status.lastError}</p>
{/if}
{#if form?.action === 'check' && form.ok}
	<p class="notice">Checking in the next few seconds.</p>
{/if}

<section class="panel">
	<h2>Your matches</h2>
	{#if data.link && !editing}
		<dl>
			<dt>Steam account</dt>
			<dd>
				<a
					href="https://steamcommunity.com/profiles/{data.link.steamId}"
					target="_blank"
					rel="noopener noreferrer"
				>
					{data.link.steamId}
				</a>
			</dd>
			<dt>Auth code</dt>
			<dd>{data.link.authCode}</dd>
			<dt>Status</dt>
			<dd>
				{#if data.link.enabled}
					<span class="pill ok">On</span> checked {ago(data.link.lastCheckedAt)}
				{:else}
					<span class="pill bad">Paused</span>
				{/if}
			</dd>
		</dl>
		{#if data.link.lastError}<p class="form-error">{data.link.lastError}</p>{/if}
		<div class="row">
			<button type="button" class="button" onclick={() => (editing = true)}>Change</button>
			<form method="POST" action="?/unlink">
				<button type="submit" class="danger">Stop importing</button>
			</form>
		</div>
	{:else}
		<p class="hint">
			Get your auth code and your latest match code on
			<a href={helpUrl} target="_blank" rel="noopener noreferrer">Steam’s CS2 match history page</a>
			(“Access to Your Match History”). The app imports that match and everything you play after it.
		</p>
		<form method="POST" action="?/link" class="grid">
			<label>
				Steam profile
				<input
					name="steamId"
					required
					placeholder="76561198… or steamcommunity.com/profiles/…"
					value={form?.action === 'link'
						? (form.values?.steamId ?? '')
						: (data.link?.steamId ?? '')}
				/>
			</label>
			<label>
				Match history auth code
				<input
					name="authCode"
					required={!data.link}
					placeholder={data.link ? 'Leave empty to keep the current one' : 'AAAA-AAAAA-AAAA'}
					autocomplete="off"
				/>
			</label>
			<label>
				Latest match code
				<input
					name="knownCode"
					required
					placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
					autocomplete="off"
					value={form?.action === 'link' ? (form.values?.knownCode ?? '') : ''}
				/>
			</label>
			{#if form?.action === 'link' && form.message}<p class="form-error">{form.message}</p>{/if}
			<div class="row">
				<button type="submit" class="primary">{data.link ? 'Save' : 'Start importing'}</button>
				{#if data.link}<button type="button" class="button" onclick={() => (editing = false)}
						>Cancel</button
					>{/if}
			</div>
		</form>
	{/if}
</section>

<section class="panel">
	<h2>Recent imports</h2>
	{#if data.recent.length === 0}
		<p class="hint">Nothing yet.</p>
	{:else}
		<ul class="list">
			{#each data.recent as match (match.matchId)}
				{@const status = statusOf(match)}
				<li>
					<span class="when"
						>{match.matchTime ? formatDate(match.matchTime) : `found ${ago(match.createdAt)}`}</span
					>
					<span class="muted">{match.foundBy ?? ''}</span>
					<span class="pill {status.tone}" title={match.error ?? undefined}>{status.label}</span>
					{#if match.error && status.tone !== 'ok'}<span class="error-text">{match.error}</span
						>{/if}
					<span class="actions">
						{#if match.demoId && match.demoStatus === 'ready'}
							<a class="button small" href="/demos/{match.demoId}">Watch</a>
						{:else if match.status === 'failed' || match.status === 'unavailable'}
							<form method="POST" action="?/retry">
								<input type="hidden" name="matchId" value={match.matchId} />
								<button type="submit" class="small">Retry</button>
							</form>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if data.admin}
	<section class="panel">
		<h2>Steam setup <span class="muted">(admins)</span></h2>

		<h3>Web API key</h3>
		<p class="hint">
			Used to look up new match codes. Any account’s key works:
			<a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer"
				>steamcommunity.com/dev/apikey</a
			>.
		</p>
		{#if data.admin.apiKey}
			<div class="row">
				<span>Saved key {data.admin.apiKey}</span>
				<form method="POST" action="?/removeApiKey">
					<button type="submit" class="small danger">Remove</button>
				</form>
			</div>
		{/if}
		<form method="POST" action="?/apiKey" class="row">
			<input
				name="apiKey"
				placeholder={data.admin.apiKey ? 'Replace the key' : '32-character key'}
				autocomplete="off"
				required
			/>
			<button type="submit">Save key</button>
		</form>
		{#if form?.action === 'apiKey' && form.message}<p class="form-error">{form.message}</p>{/if}

		<h3>Bot account</h3>
		<p class="hint">
			A separate, free Steam account that briefly launches CS2 to ask Valve for demo links. Don’t
			use your own account: it would kick you out of CS2. The password is only used for this login;
			the app keeps a login token (valid for about 200 days), not the password.
		</p>

		{#if data.admin.bot}
			<div class="row">
				<span>
					Connected as <strong>{data.admin.bot.accountName}</strong>
					{#if data.admin.bot.validUntil}· login valid until {formatDate(
							data.admin.bot.validUntil
						)}{/if}
				</span>
				<form method="POST" action="?/botDisconnect">
					<button type="submit" class="small danger">Disconnect</button>
				</form>
			</div>
		{/if}

		{#if login?.step === 'code'}
			<form method="POST" action="?/botCode" class="row">
				<label>
					{login.guard === 'email'
						? `Steam Guard code from the email${login.detail ? ` (${login.detail})` : ''}`
						: 'Steam Guard code from the Steam app'}
					<input name="code" required autocomplete="one-time-code" />
				</label>
				<button type="submit" class="primary">Continue</button>
			</form>
			{#if login.wrongCode}<p class="form-error">That code is wrong. Try again.</p>{/if}
		{:else if login?.step === 'confirm'}
			<p class="notice">
				Approve the login in the Steam app on the bot account’s phone. This page updates on its own.
			</p>
		{:else if login?.step === 'done'}
			<p class="form-ok">Connected as {login.accountName}.</p>
		{:else}
			{#if login?.step === 'error'}<p class="form-error">{login.message}</p>{/if}
			{#if !data.admin.bot || login?.step === 'error'}
				<form method="POST" action="?/botStart" class="grid">
					<label>
						Bot account name
						<input name="accountName" autocomplete="off" required />
					</label>
					<label>
						Password
						<input name="password" type="password" autocomplete="off" required />
					</label>
					<div class="row"><button type="submit" class="primary">Connect</button></div>
				</form>
			{/if}
		{/if}
		{#if login?.step === 'code' || login?.step === 'confirm'}
			<form method="POST" action="?/botCancel">
				<button type="submit" class="small">Cancel login</button>
			</form>
		{/if}
		{#if form?.action === 'bot' && form.message}<p class="form-error">{form.message}</p>{/if}
	</section>
{/if}

<style>
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 18px;
	}

	h1 {
		margin: 0 0 4px;
		font-size: 22px;
	}

	.panel {
		display: grid;
		gap: 12px;
		max-width: 820px;
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
		font-size: 14px;
	}

	.grid {
		display: grid;
		gap: 12px;
		max-width: 420px;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.row input {
		flex: 1;
		min-width: 220px;
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 6px 16px;
		margin: 0;
	}

	dt {
		color: var(--muted);
		font-size: 13px;
	}

	dd {
		margin: 0;
	}

	.notice {
		max-width: 820px;
		margin: 0 0 14px;
		padding: 10px 14px;
		border-left: 3px solid var(--accent);
		border-radius: 6px;
		background: var(--surface);
		font-size: 14px;
	}

	.notice.bad {
		border-left-color: var(--danger);
	}

	.panel .notice {
		margin: 0;
		background: var(--surface-2);
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
		gap: 4px 12px;
		padding: 8px 12px;
		border-radius: 8px;
		background: var(--surface-2);
		font-size: 14px;
	}

	.when {
		min-width: 170px;
		font-variant-numeric: tabular-nums;
	}

	.actions {
		margin-left: auto;
	}

	.muted {
		color: var(--muted);
		font-size: 13px;
		font-weight: 400;
	}

	.error-text {
		flex-basis: 100%;
		color: var(--muted);
		font-size: 12.5px;
	}

	.pill {
		padding: 1px 9px;
		border-radius: 999px;
		background: var(--bg);
		color: var(--muted);
		font-size: 12px;
		font-weight: 600;
	}

	.pill.ok {
		color: var(--ok);
	}

	.pill.busy {
		color: var(--warn);
	}

	.pill.bad {
		color: var(--danger);
	}

	.button.small {
		height: 30px;
		padding: 0 10px;
		font-size: 13px;
	}
</style>
