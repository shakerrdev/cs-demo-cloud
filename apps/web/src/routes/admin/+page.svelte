<script lang="ts">
	import {
		SOUND_GROUPS,
		SOUND_GROUP_NAMES,
		configSections,
		readPath,
		type ConfigField
	} from '@cs-demo-cloud/replay';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let values = $state(initial());
	let confirmReset = $state(false);

	$effect(() => {
		data.config;
		values = initial();
	});

	function initial(): Record<string, string | number | boolean> {
		const out: Record<string, string | number | boolean> = {};
		for (const section of configSections)
			for (const field of section.fields)
				out[field.path] = readPath(data.config, field.path) as string | number | boolean;
		return out;
	}

	const isGroupField = (field: ConfigField) => field.path.startsWith('audio.groups.');

	function shown(field: ConfigField & { kind: 'range' }, value: number): string {
		if (field.percent) return `${Math.round(value * 100)}%`;
		return `${value}${field.unit ?? ''}`;
	}

	const groupVolume = (group: string) => `audio.groups.${group}.volume`;
	const groupEnabled = (group: string) => `audio.groups.${group}.enabled`;
</script>

<svelte:head><title>Admin · cs-demo-cloud</title></svelte:head>

<h1>Admin</h1>
<p class="intro">
	Settings for everyone on this server. They apply the next time a match page opens.
</p>

<form method="POST" action="?/save" class="settings">
	{#each configSections as section (section.id)}
		<section class="panel">
			<h2>{section.title}</h2>
			{#if section.help}<p class="muted">{section.help}</p>{/if}
			<div class="fields">
				{#each section.fields.filter((field) => !isGroupField(field)) as field (field.path)}
					{@render control(field)}
				{/each}
			</div>
			{#if section.id === 'audio'}
				<h3>Sounds</h3>
				<div class="groups" class:off={!values['audio.enabled']}>
					{#each SOUND_GROUPS as group (group)}
						<label class="group" class:muted-row={!values[groupEnabled(group)]}>
							<input
								type="checkbox"
								name={groupEnabled(group)}
								bind:checked={values[groupEnabled(group)] as boolean}
							/>
							<span class="name">{SOUND_GROUP_NAMES[group]}</span>
							<input
								type="range"
								name={groupVolume(group)}
								min="0"
								max="1.5"
								step="0.05"
								bind:value={values[groupVolume(group)]}
								aria-label="{SOUND_GROUP_NAMES[group]} volume"
							/>
							<span class="value">{Math.round(Number(values[groupVolume(group)]) * 100)}%</span>
						</label>
					{/each}
				</div>
			{/if}
		</section>
	{/each}

	<div class="bar">
		<button type="submit" class="primary">Save settings</button>
		{#if form?.saved}<span class="saved">Saved</span>{/if}
		<span class="spacer"></span>
		{#if confirmReset}
			<span class="muted">Put every setting back to its default?</span>
			<button type="submit" formaction="?/reset" class="danger">Reset</button>
			<button type="button" onclick={() => (confirmReset = false)}>Cancel</button>
		{:else}
			<button type="button" onclick={() => (confirmReset = true)}>Reset to defaults</button>
		{/if}
	</div>
</form>

{#snippet control(field: ConfigField)}
	<label class="field" class:toggle={field.kind === 'toggle'}>
		{#if field.kind === 'toggle'}
			<input type="checkbox" name={field.path} bind:checked={values[field.path] as boolean} />
			<span class="label">{field.label}</span>
		{:else}
			<span class="label">{field.label}</span>
			{#if field.kind === 'range'}
				<span class="range">
					<input
						type="range"
						name={field.path}
						min={field.min}
						max={field.max}
						step={field.step}
						bind:value={values[field.path]}
					/>
					<span class="value">{shown(field, Number(values[field.path]))}</span>
				</span>
			{:else if field.kind === 'select'}
				<select name={field.path} bind:value={values[field.path]}>
					{#each field.options as option (option.value)}
						<option
							value={typeof values[field.path] === 'number' ? Number(option.value) : option.value}
							>{option.label}</option
						>
					{/each}
				</select>
			{:else if field.kind === 'color'}
				<input type="color" name={field.path} bind:value={values[field.path]} />
			{/if}
		{/if}
		{#if field.help}<span class="help">{field.help}</span>{/if}
	</label>
{/snippet}

<style>
	h1 {
		margin: 0 0 6px;
		font-size: 22px;
	}

	.intro {
		margin: 0 0 18px;
		color: var(--muted);
		font-size: 14px;
	}

	.panel {
		display: grid;
		gap: 12px;
		max-width: 760px;
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
		margin: 6px 0 0;
		color: var(--muted);
		font-size: 13px;
		font-weight: 600;
	}

	.muted {
		margin: 0;
		color: var(--muted);
		font-size: 13px;
	}

	.fields {
		display: grid;
		gap: 14px;
	}

	.field {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
		align-items: center;
		gap: 4px 16px;
		font-size: 14px;
	}

	.field.toggle {
		grid-template-columns: auto minmax(0, 1fr);
		justify-content: start;
	}

	.help {
		grid-column: 1 / -1;
		color: var(--muted);
		font-size: 12.5px;
	}

	.field.toggle .help {
		padding-left: 26px;
	}

	.range {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.range input {
		flex: 1;
		min-width: 0;
		accent-color: var(--accent);
	}

	.value {
		min-width: 44px;
		color: var(--muted);
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	select,
	input[type='color'] {
		justify-self: start;
	}

	input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
	}

	.groups {
		display: grid;
		gap: 6px;
	}

	.groups.off {
		opacity: 0.5;
	}

	.group {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) minmax(90px, 220px) 44px;
		align-items: center;
		gap: 12px;
		padding: 7px 10px;
		border-radius: 8px;
		background: var(--surface-2);
		font-size: 14px;
	}

	.group input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
	}

	.group.muted-row .name,
	.group.muted-row .value {
		opacity: 0.45;
	}

	.bar {
		position: sticky;
		bottom: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		max-width: 760px;
		padding: 12px 0;
		background: var(--bg);
	}

	.spacer {
		flex: 1;
	}

	.saved {
		color: #4cc38a;
		font-size: 13.5px;
	}

	@media (max-width: 560px) {
		.field {
			grid-template-columns: 1fr;
		}

		.group {
			grid-template-columns: auto minmax(0, 1fr) 44px;
		}

		.group input[type='range'] {
			grid-column: 2 / -1;
		}
	}
</style>
