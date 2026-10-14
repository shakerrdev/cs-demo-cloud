<script lang="ts">
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>cs-demo-cloud</title>
</svelte:head>

<header>
	<a class="brand" href="/">
		<img src={favicon} alt="" width="22" height="22" />
		cs-demo-cloud
	</a>
	{#if data.user}
		<nav>
			<a href="/" class:active={page.url.pathname === '/'}>Matches</a>
			<a href="/auto-import" class:active={page.url.pathname === '/auto-import'}>Auto-import</a>
			<a href="/settings" class:active={page.url.pathname === '/settings'}>Settings</a>
			<form method="POST" action="/logout">
				<button type="submit" title="Sign out">{data.user.name} · Sign out</button>
			</form>
		</nav>
	{/if}
</header>

<main>
	{@render children()}
</main>

<style>
	:global(:root) {
		--bg: #0e1013;
		--surface: #15181d;
		--surface-2: #1c2027;
		--border: #262b33;
		--text: #e7e9ec;
		--muted: #8a919c;
		--accent: #f2a33a;
		--ok: #4cc38a;
		--warn: #e5b84a;
		--danger: #ef5f5f;
		--radius: 10px;
		color-scheme: dark;
	}

	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font:
			15px/1.5 system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
		-webkit-font-smoothing: antialiased;
	}

	:global(a) {
		color: inherit;
	}

	:global(label) {
		display: grid;
		gap: 5px;
		color: var(--muted);
		font-size: 13px;
		font-weight: 600;
	}

	:global(input:not([type='file']):not([type='range']):not([type='hidden']), select) {
		height: 38px;
		padding: 0 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-weight: 400;
	}

	:global(input:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	:global(form button, .button) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 38px;
		padding: 0 16px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}

	:global(button.primary) {
		border-color: var(--accent);
		background: var(--accent);
		color: #1a1206;
	}

	:global(button.small) {
		height: 30px;
		padding: 0 10px;
		font-size: 13px;
	}

	:global(button.danger) {
		color: var(--danger);
	}

	:global(.card) {
		display: grid;
		gap: 14px;
		width: min(100%, 380px);
		margin: 8vh auto 0;
		padding: 28px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	:global(.card h1) {
		margin: 0;
		font-size: 22px;
	}

	:global(.card p) {
		margin: 0;
	}

	:global(.hint) {
		margin: 0;
		color: var(--muted);
		font-size: 13px;
	}

	:global(.form-error) {
		margin: 0;
		color: var(--danger);
		font-size: 14px;
	}

	:global(.form-ok) {
		color: var(--ok);
		font-size: 14px;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		height: 56px;
		padding: 0 24px;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 650;
		letter-spacing: 0.01em;
		text-decoration: none;
	}

	nav {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	nav a,
	nav button {
		height: 34px;
		padding: 0 12px;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		line-height: 34px;
		text-decoration: none;
		cursor: pointer;
	}

	nav a:hover,
	nav button:hover,
	nav a.active {
		background: var(--surface-2);
		color: var(--text);
	}

	main {
		max-width: 1440px;
		margin: 0 auto;
		padding: 32px 24px;
	}
</style>
