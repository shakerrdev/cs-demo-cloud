<script lang="ts" module>
	import type { TeamKey } from '@cs-demo-cloud/replay';

	export interface StackEntry {
		key: string;
		demoId: string;
		version: number;
		round: number;
		team: TeamKey;
		steamid?: string | null;
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { maps, worldToRadar, type RoundReplay } from '@cs-demo-cloud/replay';
	import { formatClock } from '#lib/format.ts';
	import { sideColors } from '#lib/viewer/draw.ts';
	import { lastTick, playerStates } from '#lib/viewer/frame.ts';
	import { loadRound } from '#lib/viewer/loader.ts';

	interface Props {
		map: string;
		entries: StackEntry[];
		opponents?: boolean;
		teammates?: boolean;
	}

	let { map, entries, opponents = false, teammates = true }: Props = $props();

	let replays = $state.raw<Map<string, RoundReplay>>(new Map());
	let loading = $state(0);
	let seconds = $state(0);
	let playing = $state(false);
	let level = $state<'upper' | 'lower'>('upper');
	let canvas: HTMLCanvasElement | undefined = $state();
	let radar = $state.raw<HTMLImageElement | null>(null);
	let lowerRadar = $state.raw<HTMLImageElement | null>(null);

	const info = $derived(maps[map] ?? null);
	const hasLower = $derived(info !== null && info.lowerBelowZ !== null);
	const replayKey = (entry: StackEntry) => `${entry.demoId}/${entry.version}/${entry.round}`;

	$effect(() => {
		const list = entries;
		const wanted = untrack(() => list.filter((entry) => !replays.has(replayKey(entry))));
		if (!wanted.length) return;
		let cancelled = false;
		loading = wanted.length;
		const queue = [...wanted];
		const work = async () => {
			while (queue.length && !cancelled) {
				const entry = queue.shift()!;
				const replay = await loadRound(entry.demoId, entry.version, entry.round).catch(() => null);
				if (cancelled) return;
				loading--;
				if (replay) replays = new Map(replays).set(replayKey(entry), replay);
			}
		};
		for (let i = 0; i < 4; i++) void work();
		return () => {
			cancelled = true;
		};
	});

	const length = $derived(
		Math.max(
			30,
			...entries.map((entry) => {
				const replay = replays.get(replayKey(entry));
				if (!replay) return 0;
				const start = replay.meta.freezeEndTick ?? replay.meta.startTick;
				return (lastTick(replay) - start) / replay.meta.tickRate;
			})
		)
	);

	$effect(() => {
		const name = map;
		radar = null;
		lowerRadar = null;
		const upper = new Image();
		upper.onload = () => (radar = upper);
		upper.src = `/maps/${name}.png`;
		if (hasLower) {
			const lower = new Image();
			lower.onload = () => (lowerRadar = lower);
			lower.src = `/maps/${name}_lower.png`;
		}
	});

	$effect(() => {
		if (!playing) return;
		let last = performance.now();
		let frame = requestAnimationFrame(function step(now) {
			seconds = Math.min(length, seconds + (now - last) / 1000);
			last = now;
			if (seconds >= length) playing = false;
			else frame = requestAnimationFrame(step);
		});
		return () => cancelAnimationFrame(frame);
	});

	const image = $derived(level === 'lower' && lowerRadar ? lowerRadar : radar);

	$effect(() => {
		if (!canvas || !info) return;
		const ratio = devicePixelRatio || 1;
		const size = canvas.clientWidth;
		canvas.width = size * ratio;
		canvas.height = size * ratio;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.clearRect(0, 0, size, size);
		if (!image) return;
		ctx.globalAlpha = 0.85;
		ctx.drawImage(image, 0, 0, size, size);
		ctx.globalAlpha = 1;
		const project = (x: number, y: number) => {
			const { u, v } = worldToRadar(info, image.naturalWidth, x, y);
			return { px: u * size, py: v * size };
		};
		const dot = Math.max(3, size / 150);
		const onLevel = (z: number) => !hasLower || z < info.lowerBelowZ! === (level === 'lower');
		for (const entry of entries) {
			const replay = replays.get(replayKey(entry));
			if (!replay) continue;
			const start = replay.meta.freezeEndTick ?? replay.meta.startTick;
			const tick = Math.min(lastTick(replay), start + seconds * replay.meta.tickRate);
			const trailStart = Math.max(start, tick - 3 * replay.meta.tickRate);
			const now = playerStates(replay, tick);
			const before = playerStates(replay, trailStart);
			for (const player of now) {
				const own = player.team === entry.team;
				const main = own && (!entry.steamid || player.steamid === entry.steamid);
				if (!own && !opponents) continue;
				if (own && !main && !teammates) continue;
				const color = sideColors[player.side];
				const size = main ? dot : dot * 0.7;
				const { px, py } = project(player.x, player.y);
				const alpha = (onLevel(player.z) ? 1 : 0.25) * (main ? 1 : 0.55);
				ctx.globalAlpha = alpha;
				if (!player.alive) {
					ctx.strokeStyle = color;
					ctx.lineWidth = 1.5;
					const s = size * 0.8;
					ctx.beginPath();
					ctx.moveTo(px - s, py - s);
					ctx.lineTo(px + s, py + s);
					ctx.moveTo(px + s, py - s);
					ctx.lineTo(px - s, py + s);
					ctx.stroke();
					continue;
				}
				const past = before[player.index];
				if (past?.alive && main) {
					const from = project(past.x, past.y);
					ctx.strokeStyle = color;
					ctx.globalAlpha = alpha * 0.35;
					ctx.lineWidth = 2;
					ctx.beginPath();
					ctx.moveTo(from.px, from.py);
					ctx.lineTo(px, py);
					ctx.stroke();
					ctx.globalAlpha = alpha;
				}
				ctx.fillStyle = color;
				ctx.strokeStyle = 'rgba(0,0,0,0.7)';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.arc(px, py, size, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			}
		}
		ctx.globalAlpha = 1;
	});
</script>

{#if !info}
	<p class="hint">There is no radar calibration for this map.</p>
{:else}
	<div class="stack">
		{#if hasLower}
			<div class="toggle" role="group" aria-label="Level">
				<button type="button" aria-pressed={level === 'upper'} onclick={() => (level = 'upper')}
					>Upper</button
				>
				<button type="button" aria-pressed={level === 'lower'} onclick={() => (level = 'lower')}
					>Lower</button
				>
			</div>
		{/if}
		<canvas bind:this={canvas}></canvas>
		<div class="timeline">
			<button
				type="button"
				class="play"
				onclick={() => {
					if (seconds >= length) seconds = 0;
					playing = !playing;
				}}>{playing ? 'Pause' : 'Play'}</button
			>
			<input
				type="range"
				min="0"
				max={length}
				step="0.1"
				bind:value={seconds}
				oninput={() => (playing = false)}
				aria-label="Time since the round started"
			/>
			<span class="time">+{formatClock(seconds)}</span>
		</div>
		<p class="hint">
			{loading > 0
				? `Loading ${loading} rounds…`
				: 'Every round plays at once from the end of freeze time, with a 3 s trail.'}
		</p>
	</div>
{/if}

<style>
	.stack {
		display: grid;
		gap: 10px;
		justify-items: center;
	}

	.toggle {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 6px;
		overflow: hidden;
	}

	.toggle button {
		background: transparent;
		color: var(--muted);
		border: 0;
		padding: 4px 10px;
		cursor: pointer;
	}

	.toggle button[aria-pressed='true'] {
		background: var(--border);
		color: var(--text);
	}

	canvas {
		display: block;
		width: min(100%, 720px);
		aspect-ratio: 1;
		border-radius: 8px;
		background: var(--bg);
	}

	.timeline {
		display: flex;
		align-items: center;
		gap: 10px;
		width: min(100%, 720px);
	}

	.timeline input {
		flex: 1;
		accent-color: var(--accent);
	}

	.play {
		min-width: 70px;
		padding: 6px 12px;
		border-radius: 8px;
		border: 0;
		background: var(--accent);
		color: #1a1206;
		font-weight: 600;
		cursor: pointer;
	}

	.time {
		font-variant-numeric: tabular-nums;
		color: var(--muted);
		min-width: 44px;
	}

	.hint {
		margin: 0;
		color: var(--muted);
		font-size: 0.85em;
		text-align: center;
	}
</style>
