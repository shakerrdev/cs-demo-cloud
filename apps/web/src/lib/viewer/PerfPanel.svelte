<script lang="ts">
	import { onMount } from 'svelte';
	import { profiler, type PerfSummary } from './perf.ts';

	interface Props {
		benchStatus: string | null;
		scale: number;
		onBench: () => void;
		onSave: (kind: 'recording' | 'snapshot') => void;
		onClose: () => void;
	}

	let { benchStatus, scale, onBench, onSave, onClose }: Props = $props();

	let summary = $state<PerfSummary | null>(null);
	let recordingUntil = $state(0);
	let now = $state(performance.now());
	const RECORD_SECONDS = 30;

	onMount(() => {
		const timer = setInterval(() => {
			now = performance.now();
			summary = profiler.summary(2);
			if (recordingUntil && now >= recordingUntil) {
				recordingUntil = 0;
				onSave('recording');
			}
		}, 500);
		return () => clearInterval(timer);
	});

	function record() {
		profiler.clear();
		profiler.note('recording started');
		recordingUntil = performance.now() + RECORD_SECONDS * 1000;
	}

	const top = $derived(
		summary
			? Object.entries(summary.sections)
					.sort((a, b) => b[1].avg - a[1].avg)
					.slice(0, 6)
			: []
	);
	const gpu = $derived(summary?.gpu ? Object.entries(summary.gpu) : []);
	const left = $derived(recordingUntil ? Math.max(0, Math.ceil((recordingUntil - now) / 1000)) : 0);
</script>

<div class="perf" role="dialog" aria-label="Performance">
	<header>
		<strong>Performance</strong>
		<button type="button" class="x" onclick={onClose} aria-label="Close">×</button>
	</header>
	{#if summary && summary.frames}
		<dl>
			<dt>FPS</dt>
			<dd>{summary.fps.toFixed(0)}</dd>
			<dt>Frame</dt>
			<dd>{summary.interval.p50} / {summary.interval.p95} / {summary.interval.max} ms</dd>
			<dt>JS</dt>
			<dd>{summary.cpu.avg} ms (+{summary.after.avg} UI)</dd>
			<dt>Draws</dt>
			<dd>{summary.draws} · {(summary.triangles / 1e6).toFixed(2)} M tris</dd>
			<dt>Scale</dt>
			<dd>{Math.round(scale * 100)}%</dd>
		</dl>
		<p class="label">JS per frame (avg ms)</p>
		<ul>
			{#each top as [name, value] (name)}
				<li><span>{name}</span><span>{value.avg}</span></li>
			{/each}
		</ul>
		{#if gpu.length}
			<p class="label">GPU (avg ms)</p>
			<ul>
				{#each gpu as [name, value] (name)}
					<li><span>{name}</span><span>{value.avg}</span></li>
				{/each}
			</ul>
		{:else}
			<p class="hint">No GPU timers in this browser; the benchmark measures them another way.</p>
		{/if}
	{:else}
		<p class="hint">Play the round to see numbers.</p>
	{/if}
	<div class="actions">
		{#if benchStatus && benchStatus !== 'done'}
			<span class="status">Benchmark {benchStatus}</span>
		{:else if left}
			<span class="status">Recording… {left} s</span>
		{:else}
			<button type="button" onclick={record} title="Record {RECORD_SECONDS} s, then save a report"
				>Record {RECORD_SECONDS} s</button
			>
			<button
				type="button"
				onclick={onBench}
				title="Tries each graphics option for a few seconds, then saves a report">Benchmark</button
			>
			<button type="button" onclick={() => onSave('snapshot')}>Save</button>
		{/if}
	</div>
	<p class="hint">
		Keep the round playing (POV, full screen if that’s where it stutters). Reports land in your
		downloads.
	</p>
</div>

<style>
	.perf {
		position: absolute;
		top: 10px;
		left: 10px;
		z-index: 30;
		width: 250px;
		padding: 10px 12px;
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 8px;
		background: rgba(10, 12, 16, 0.88);
		color: #e8eaed;
		font:
			12px/1.35 ui-monospace,
			SFMono-Regular,
			Menlo,
			Consolas,
			monospace;
		pointer-events: auto;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}

	.x {
		background: none;
		border: 0;
		color: inherit;
		font-size: 16px;
		cursor: pointer;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 10px;
		margin: 0;
	}

	dt {
		color: #9aa0a6;
	}

	dd {
		margin: 0;
		text-align: right;
	}

	.label {
		margin: 8px 0 2px;
		color: #9aa0a6;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		justify-content: space-between;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 10px;
	}

	.actions button {
		padding: 4px 8px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.08);
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.status {
		color: #f5b14c;
	}

	.hint {
		margin: 8px 0 0;
		color: #9aa0a6;
		font-size: 11px;
	}
</style>
