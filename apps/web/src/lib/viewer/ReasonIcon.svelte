<script lang="ts">
	let { reason }: { reason: string | null } = $props();

	const kind = $derived(
		reason === 'bomb_exploded' || reason === 'target_bombed'
			? 'bomb'
			: reason === 'bomb_defused'
				? 'defuse'
				: reason === 'target_saved'
					? 'time'
					: reason === 't_killed' || reason === 'ct_killed'
						? 'elimination'
						: reason?.includes('surrender')
							? 'surrender'
							: null
	);
</script>

{#if kind}
	<svg class="reason {kind}" viewBox="0 0 12 12" aria-hidden="true">
		{#if kind === 'elimination'}
			<path
				d="M6 1.5a3.6 3.6 0 0 0-3.6 3.6c0 1.3.7 2.3 1.5 2.9V10h4.2V8c.8-.6 1.5-1.6 1.5-2.9A3.6 3.6 0 0 0 6 1.5Z"
			/>
			<circle cx="4.6" cy="5.3" r=".9" class="cut" />
			<circle cx="7.4" cy="5.3" r=".9" class="cut" />
		{:else if kind === 'bomb'}
			<rect x="2" y="3.5" width="8" height="6" rx="1" />
			<path d="M8 3.5V2h1.5" class="line" />
		{:else if kind === 'defuse'}
			<path d="M2 4.5h8v5H2z" class="line" />
			<path d="M4.5 4.5V2.8h3v1.7M6 6v2.2M4.9 7.1h2.2" class="line" />
		{:else if kind === 'time'}
			<circle cx="6" cy="6.5" r="4" class="line" />
			<path d="M6 4.5V6.8L7.5 7.8" class="line" />
		{:else}
			<path d="M3 10V2l6 2.5L3 7" class="line" />
		{/if}
	</svg>
{/if}

<style>
	.reason {
		display: block;
		width: 11px;
		height: 11px;
		margin: 2px auto 0;
		fill: currentColor;
		opacity: 0.8;
	}

	.cut {
		fill: var(--surface, #15181d);
	}

	.line {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
