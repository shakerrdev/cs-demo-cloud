<script lang="ts" module>
	export type KillIconKind = 'headshot' | 'wallbang' | 'smoke' | 'noscope' | 'blind' | 'flash';

	export const killIconTitles: Record<KillIconKind, string> = {
		headshot: 'Headshot',
		wallbang: 'Through a wall',
		smoke: 'Through smoke',
		noscope: 'No-scope',
		blind: 'Killer was flashed',
		flash: 'Flash assist'
	};
</script>

<script lang="ts">
	let { kind }: { kind: KillIconKind } = $props();
</script>

<svg
	class="kill-icon {kind}"
	viewBox="0 0 16 16"
	width="1.15em"
	height="1.15em"
	role="img"
	aria-label={killIconTitles[kind]}
>
	<title>{killIconTitles[kind]}</title>
	{#if kind === 'headshot'}
		<circle cx="8" cy="7" r="4.3" fill="none" stroke="currentColor" stroke-width="1.6" />
		<path
			d="M4.5 13.5c1-1.6 2.2-2.2 3.5-2.2s2.5.6 3.5 2.2"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
		/>
		<circle cx="8" cy="7" r="1.4" fill="currentColor" />
	{:else if kind === 'wallbang'}
		<rect x="6.5" y="1.5" width="3" height="13" fill="currentColor" opacity="0.55" />
		<path
			d="M1 8h12.5M10.5 5l3 3-3 3"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	{:else if kind === 'smoke'}
		<path
			d="M4.2 12.5h7.6a2.8 2.8 0 0 0 .4-5.6 3.6 3.6 0 0 0-6.9-.9 3.2 3.2 0 0 0-1.1 6.5z"
			fill="currentColor"
			opacity="0.85"
		/>
	{:else if kind === 'noscope'}
		<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5" />
		<path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1" opacity="0.7" />
		<path d="M2.5 13.5l11-11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
	{:else if kind === 'blind'}
		<path
			d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8z"
			fill="none"
			stroke="currentColor"
			stroke-width="1.4"
		/>
		<circle cx="8" cy="8" r="1.8" fill="currentColor" />
		<path d="M2.5 13.5l11-11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
	{:else}
		<path
			d="M8 1.5l1.3 4 4.2-1.3-2.6 3.8 2.6 3.8-4.2-1.3L8 14.5l-1.3-4-4.2 1.3 2.6-3.8-2.6-3.8 4.2 1.3z"
			fill="currentColor"
		/>
	{/if}
</svg>

<style>
	.kill-icon {
		display: inline-block;
		vertical-align: -0.2em;
		flex: none;
	}

	.headshot {
		color: #ff5c5c;
	}

	.flash,
	.blind {
		color: #fff3a8;
	}
</style>
