<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
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

	header {
		display: flex;
		align-items: center;
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

	main {
		max-width: 1100px;
		margin: 0 auto;
		padding: 32px 24px;
	}
</style>
