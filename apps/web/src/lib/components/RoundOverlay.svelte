<script lang="ts">
	import {
		buyLabels,
		maps,
		worldToRadar,
		type BuyType,
		type RoundReplay,
		type Side,
		type TeamKey
	} from '@cs-demo-cloud/replay';
	import { formatClock } from '#lib/format.ts';
	import { sideColors } from '#lib/viewer/draw.ts';
	import { lastTick, playerStates } from '#lib/viewer/frame.ts';
	import { loadAllRounds } from '#lib/viewer/loader.ts';

	interface RoundRow {
		number: number;
		teamASide: Side;
		winnerTeam: TeamKey | null;
	}

	interface Props {
		demoId: string;
		version: number;
		map: string;
		rounds: RoundRow[];
		buys: Map<number, Record<TeamKey, BuyType> | null>;
		teamNames: Record<TeamKey, string>;
	}

	let { demoId, version, map, rounds, buys, teamNames }: Props = $props();

	let replays = $state.raw<Map<number, RoundReplay>>(new Map());
	let loaded = $state(0);
	let team = $state<TeamKey>('a');
	let side = $state<Side>('T');
	let buy = $state<'any' | BuyType>('any');
	let result = $state<'any' | 'won' | 'lost'>('any');
	let opponents = $state(false);
	let seconds = $state(0);
	let playing = $state(false);
	let level = $state<'upper' | 'lower'>('upper');
	let canvas: HTMLCanvasElement | undefined = $state();
	let radar = $state.raw<HTMLImageElement | null>(null);
	let lowerRadar = $state.raw<HTMLImageElement | null>(null);

	const info = $derived(maps[map] ?? null);
	const hasLower = $derived(info !== null && info.lowerBelowZ !== null);
	const sideOf = (row: RoundRow, key: TeamKey): Side =>
		key === 'a' ? row.teamASide : row.teamASide === 'CT' ? 'T' : 'CT';

	const chosen = $derived(
		rounds.filter((row) => {
			if (sideOf(row, team) !== side) return false;
			if (buy !== 'any' && buys.get(row.number)?.[team] !== buy) return false;
			if (result === 'won' && row.winnerTeam !== team) return false;
			if (result === 'lost' && row.winnerTeam === team) return false;
			return true;
		})
	);

	const length = $derived(
		Math.max(
			30,
			...chosen.map((row) => {
				const replay = replays.get(row.number);
				if (!replay) return 0;
				const start = replay.meta.freezeEndTick ?? replay.meta.startTick;
				return (lastTick(replay) - start) / replay.meta.tickRate;
			})
		)
	);

	$effect(() => {
		const numbers = rounds.map((r) => r.number);
		const collected = new Map<number, RoundReplay>();
		replays = new Map();
		loaded = 0;
		return loadAllRounds(demoId, version, numbers, (replay, number) => {
			loaded++;
			if (replay) collected.set(number, replay);
			replays = new Map(collected);
		});
	});

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
		for (const row of chosen) {
			const replay = replays.get(row.number);
			if (!replay) continue;
			const start = replay.meta.freezeEndTick ?? replay.meta.startTick;
			const tick = Math.min(lastTick(replay), start + seconds * replay.meta.tickRate);
			const trailStart = Math.max(start, tick - 3 * replay.meta.tickRate);
			const now = playerStates(replay, tick);
			const before = playerStates(replay, trailStart);
			for (const player of now) {
				const own = player.team === team;
				if (!own && !opponents) continue;
				const color = sideColors[own ? side : side === 'CT' ? 'T' : 'CT'];
				const { px, py } = project(player.x, player.y);
				ctx.globalAlpha = onLevel(player.z) ? 1 : 0.25;
				if (!player.alive) {
					ctx.strokeStyle = color;
					ctx.lineWidth = 1.5;
					const s = dot * 0.8;
					ctx.beginPath();
					ctx.moveTo(px - s, py - s);
					ctx.lineTo(px + s, py + s);
					ctx.moveTo(px + s, py - s);
					ctx.lineTo(px - s, py + s);
					ctx.stroke();
					continue;
				}
				const past = before[player.index];
				if (past?.alive) {
					const from = project(past.x, past.y);
					ctx.strokeStyle = color;
					ctx.globalAlpha *= 0.35;
					ctx.lineWidth = 2;
					ctx.beginPath();
					ctx.moveTo(from.px, from.py);
					ctx.lineTo(px, py);
					ctx.stroke();
					ctx.globalAlpha = onLevel(player.z) ? 1 : 0.25;
				}
				ctx.fillStyle = color;
				ctx.strokeStyle = 'rgba(0,0,0,0.7)';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.arc(px, py, own ? dot : dot * 0.75, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			}
		}
		ctx.globalAlpha = 1;
	});
</script>

<div class="overlay">
	<div class="filters">
		<select bind:value={team} aria-label="Team">
			<option value="a">{teamNames.a}</option>
			<option value="b">{teamNames.b}</option>
		</select>
		<div class="toggle" role="group" aria-label="Side">
			{#each ['T', 'CT'] as const as key (key)}
				<button type="button" aria-pressed={side === key} onclick={() => (side = key)}
					>{key === 'T' ? 'T side' : 'CT side'}</button
				>
			{/each}
		</div>
		<select bind:value={buy} aria-label="Buy">
			<option value="any">Any buy</option>
			{#each Object.entries(buyLabels) as [key, label] (key)}
				<option value={key}>{label}</option>
			{/each}
		</select>
		<select bind:value={result} aria-label="Result">
			<option value="any">Won or lost</option>
			<option value="won">Rounds won</option>
			<option value="lost">Rounds lost</option>
		</select>
		<label class="check"><input type="checkbox" bind:checked={opponents} /> Opponents</label>
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
		<span class="count">
			{loaded < rounds.length
				? `Loading rounds ${loaded}/${rounds.length}…`
				: `${chosen.length} rounds: ${chosen.map((r) => r.number).join(', ') || 'none'}`}
		</span>
	</div>

	{#if !info}
		<p class="hint">There is no radar calibration for this map.</p>
	{:else}
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
			Every chosen round plays at once from the end of freeze time, with a 3 s trail, so you can
			compare how the team sets up.
		</p>
	{/if}
</div>

<style>
	.overlay {
		display: grid;
		gap: 12px;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	select {
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 4px 8px;
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

	.check {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--muted);
	}

	.count {
		margin-left: auto;
		color: var(--muted);
		font-size: 0.9em;
		font-variant-numeric: tabular-nums;
	}

	canvas {
		display: block;
		width: min(100%, 720px);
		aspect-ratio: 1;
		margin: 0 auto;
		border-radius: 8px;
		background: var(--bg);
	}

	.timeline {
		display: flex;
		align-items: center;
		gap: 10px;
		width: min(100%, 720px);
		margin: 0 auto;
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
