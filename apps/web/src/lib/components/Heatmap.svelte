<script lang="ts">
	import {
		maps,
		weaponTitle,
		worldToRadar,
		type RoundReplay,
		type Side
	} from '@cs-demo-cloud/replay';
	import { loadRound } from '#lib/viewer/loader.ts';
	import { sideColors } from '#lib/viewer/draw.ts';
	import { playerStates } from '#lib/viewer/frame.ts';

	interface Props {
		demoId: string;
		version: number;
		map: string;
		roundNumbers: number[];
		players: { steamid: string; name: string }[];
	}

	interface Spot {
		round: number;
		killer: string | null;
		victim: string;
		killerSide: Side | null;
		victimSide: Side;
		from: { x: number; y: number; z: number } | null;
		to: { x: number; y: number; z: number };
		weapon: string;
		headshot: boolean;
	}

	let { demoId, version, map, roundNumbers, players }: Props = $props();

	let spots = $state.raw<Spot[]>([]);
	let loaded = $state(0);
	let failed = $state(0);
	let player = $state('');
	let show = $state<'kills' | 'deaths'>('kills');
	let side = $state<'all' | Side>('all');
	let level = $state<'upper' | 'lower'>('upper');
	let canvas: HTMLCanvasElement | undefined = $state();
	let radar = $state.raw<HTMLImageElement | null>(null);
	let lowerRadar = $state.raw<HTMLImageElement | null>(null);
	let hover = $state<{ spot: Spot; left: number; top: number } | null>(null);

	const info = $derived(maps[map] ?? null);
	const hasLower = $derived(info?.lowerBelowZ !== null && info !== null);
	const names = $derived(new Map(players.map((p) => [p.steamid, p.name])));

	function spotsOf(replay: RoundReplay): Spot[] {
		const { meta } = replay;
		return meta.kills.map((kill) => {
			const killer = meta.players[kill.attacker];
			const victim = meta.players[kill.victim]!;
			const state = killer ? playerStates(replay, kill.tick)[kill.attacker] : null;
			return {
				round: meta.round,
				killer: killer?.steamid ?? null,
				victim: victim.steamid,
				killerSide: killer?.side ?? null,
				victimSide: victim.side,
				from: state ? { x: state.x, y: state.y, z: state.z } : null,
				to: { x: kill.x, y: kill.y, z: kill.z },
				weapon: kill.weapon,
				headshot: kill.headshot
			};
		});
	}

	$effect(() => {
		const id = demoId;
		const v = version;
		const numbers = roundNumbers;
		let cancelled = false;
		spots = [];
		loaded = 0;
		failed = 0;
		const collected: Spot[][] = [];
		const queue = [...numbers];
		const worker = async () => {
			while (queue.length && !cancelled) {
				const number = queue.shift()!;
				try {
					collected[number] = spotsOf(await loadRound(id, v, number));
				} catch {
					failed++;
				}
				if (cancelled) return;
				loaded++;
				spots = collected.flat();
			}
		};
		void Promise.all([worker(), worker(), worker(), worker()]);
		return () => {
			cancelled = true;
		};
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

	const onLevel = (z: number) => !hasLower || z < info!.lowerBelowZ! === (level === 'lower');

	const visible = $derived(
		spots.filter((spot) => {
			if (!spot.killer || spot.killer === spot.victim) return show === 'deaths' && matches(spot);
			return matches(spot);
		})
	);

	function matches(spot: Spot): boolean {
		const who = show === 'kills' ? spot.killer : spot.victim;
		const whoSide = show === 'kills' ? spot.killerSide : spot.victimSide;
		if (show === 'kills' && (!spot.killer || spot.killerSide === spot.victimSide)) return false;
		if (player && who !== player) return false;
		if (side !== 'all' && whoSide !== side) return false;
		const at = show === 'kills' ? (spot.from ?? spot.to) : spot.to;
		return onLevel(at.z);
	}

	function project(size: number, image: HTMLImageElement, x: number, y: number) {
		const { u, v } = worldToRadar(info!, image.naturalWidth, x, y);
		return { px: u * size, py: v * size };
	}

	$effect(() => {
		if (!canvas || !info) return;
		const image = level === 'lower' && lowerRadar ? lowerRadar : radar;
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
		const dot = Math.max(3, size / 160);
		for (const spot of visible) {
			const color = sideColors[(show === 'kills' ? spot.killerSide : spot.victimSide) ?? 'T'];
			const end = project(size, image, spot.to.x, spot.to.y);
			if (show === 'kills' && spot.from) {
				const start = project(size, image, spot.from.x, spot.from.y);
				if (player) {
					ctx.strokeStyle = 'rgba(255,255,255,0.35)';
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(start.px, start.py);
					ctx.lineTo(end.px, end.py);
					ctx.stroke();
				}
				ctx.fillStyle = color;
				ctx.beginPath();
				ctx.arc(start.px, start.py, dot, 0, Math.PI * 2);
				ctx.fill();
				ctx.strokeStyle = '#e5484d';
				ctx.lineWidth = 1.5;
				const s = dot * 0.7;
				ctx.beginPath();
				ctx.moveTo(end.px - s, end.py - s);
				ctx.lineTo(end.px + s, end.py + s);
				ctx.moveTo(end.px + s, end.py - s);
				ctx.lineTo(end.px - s, end.py + s);
				ctx.stroke();
			} else {
				ctx.fillStyle = color;
				ctx.strokeStyle = 'rgba(0,0,0,0.6)';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.arc(end.px, end.py, dot, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			}
		}
	});

	function nearest(event: MouseEvent): { spot: Spot; px: number; py: number } | null {
		const image = level === 'lower' && lowerRadar ? lowerRadar : radar;
		if (!canvas || !image) return null;
		const rect = canvas.getBoundingClientRect();
		const mx = event.clientX - rect.left;
		const my = event.clientY - rect.top;
		let best: { spot: Spot; px: number; py: number } | null = null;
		let bestDistance = 12 ** 2;
		for (const spot of visible) {
			const at = show === 'kills' && spot.from ? spot.from : spot.to;
			const { px, py } = project(rect.width, image, at.x, at.y);
			const distance = (px - mx) ** 2 + (py - my) ** 2;
			if (distance < bestDistance) {
				bestDistance = distance;
				best = { spot, px, py };
			}
		}
		return best;
	}

	function onMove(event: MouseEvent) {
		const hit = nearest(event);
		hover = hit ? { spot: hit.spot, left: hit.px, top: hit.py } : null;
	}

	function onClick(event: MouseEvent) {
		const hit = nearest(event);
		if (hit) location.hash = `round-${hit.spot.round}`;
	}

	const nameOf = (steamid: string | null) => (steamid ? (names.get(steamid) ?? '?') : 'World');
</script>

<div class="heatmap">
	<div class="filters">
		<select bind:value={player} aria-label="Player">
			<option value="">Everyone</option>
			{#each players as p (p.steamid)}
				<option value={p.steamid}>{p.name}</option>
			{/each}
		</select>
		<div class="toggle" role="group" aria-label="Show">
			<button type="button" aria-pressed={show === 'kills'} onclick={() => (show = 'kills')}
				>Kills</button
			>
			<button type="button" aria-pressed={show === 'deaths'} onclick={() => (show = 'deaths')}
				>Deaths</button
			>
		</div>
		<div class="toggle" role="group" aria-label="Side">
			{#each ['all', 'CT', 'T'] as const as key (key)}
				<button type="button" aria-pressed={side === key} onclick={() => (side = key)}
					>{key === 'all' ? 'Both sides' : key}</button
				>
			{/each}
		</div>
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
			{#if loaded < roundNumbers.length}
				Loading rounds {loaded}/{roundNumbers.length}…
			{:else}
				{visible.length}
				{show}{failed ? ` · ${failed} rounds failed to load` : ''}
			{/if}
		</span>
	</div>

	{#if !info}
		<p class="hint">There is no radar calibration for this map, so positions can't be drawn.</p>
	{:else}
		<div class="stage">
			<canvas
				bind:this={canvas}
				onmousemove={onMove}
				onmouseleave={() => (hover = null)}
				onclick={onClick}
				class:pointer={hover !== null}
			></canvas>
			{#if hover}
				<div class="tip" style="left: {hover.left}px; top: {hover.top}px">
					<b>Round {hover.spot.round}</b>
					{nameOf(hover.spot.killer)} → {nameOf(hover.spot.victim)}
					<span
						>{weaponTitle(hover.spot.weapon)}{hover.spot.headshot ? ' · headshot' : ''} · click to watch</span
					>
				</div>
			{/if}
		</div>
		{#if show === 'kills'}
			<p class="hint">
				Dots are where the killer stood, crosses where the victim fell. Pick a player to connect
				them.
			</p>
		{/if}
	{/if}
</div>

<style>
	.heatmap {
		display: grid;
		gap: 12px;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.filters select {
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

	.count {
		margin-left: auto;
		color: var(--muted);
		font-size: 0.9em;
		font-variant-numeric: tabular-nums;
	}

	.stage {
		position: relative;
		width: min(100%, 720px);
		margin: 0 auto;
	}

	canvas {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		border-radius: 8px;
		background: var(--bg);
	}

	canvas.pointer {
		cursor: pointer;
	}

	.tip {
		position: absolute;
		transform: translate(-50%, calc(-100% - 10px));
		display: grid;
		gap: 2px;
		padding: 6px 10px;
		border-radius: 6px;
		background: rgb(0 0 0 / 0.85);
		color: #fff;
		font-size: 12px;
		white-space: nowrap;
		pointer-events: none;
	}

	.tip span {
		color: #b8bcc4;
	}

	.hint {
		margin: 0;
		color: var(--muted);
		font-size: 0.85em;
		text-align: center;
	}
</style>
