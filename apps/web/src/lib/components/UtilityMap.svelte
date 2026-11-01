<script lang="ts">
	import { maps, worldToRadar, type GrenadeType, type Side } from '@cs-demo-cloud/replay';
	import { goto } from '$app/navigation';
	import { loadRounds, type RoundSource } from '#lib/viewer/loader.ts';
	import { setposCommand } from '#lib/viewer/frame.ts';

	interface Props {
		map: string;
		sources: RoundSource[];
		players: { steamid: string; name: string }[];
		currentDemo?: string;
		player?: string;
	}

	interface Throw {
		demoId: string;
		round: number;
		type: GrenadeType;
		steamid: string;
		side: Side;
		tick: number;
		from: { x: number; y: number; z: number };
		to: { x: number; y: number; z: number };
		setpos: string | null;
	}

	const typeLabels: Record<GrenadeType, string> = {
		smoke: 'Smokes',
		flash: 'Flashes',
		he: 'HE',
		molotov: 'Molotovs',
		decoy: 'Decoys'
	};
	const typeColors: Record<GrenadeType, string> = {
		smoke: '#d4d9e0',
		flash: '#fff27a',
		he: '#ff6a3d',
		molotov: '#ff9a2e',
		decoy: '#9aa4ae'
	};

	let { map, sources, players, currentDemo, player = $bindable('') }: Props = $props();

	interface Blind {
		attacker: string;
		victim: string;
		duration: number;
		team: boolean;
	}

	let throws = $state.raw<Throw[]>([]);
	let blinds = $state.raw<Blind[]>([]);
	let loaded = $state(0);
	let types = $state<GrenadeType[]>(['smoke', 'flash', 'he', 'molotov']);
	let side = $state<'all' | Side>('all');
	let level = $state<'upper' | 'lower'>('upper');
	let canvas: HTMLCanvasElement | undefined = $state();
	let radar = $state.raw<HTMLImageElement | null>(null);
	let lowerRadar = $state.raw<HTMLImageElement | null>(null);
	let hover = $state<{ item: Throw; left: number; top: number } | null>(null);
	let copied = $state<string | null>(null);

	const info = $derived(maps[map] ?? null);
	const hasLower = $derived(info !== null && info.lowerBelowZ !== null);
	const names = $derived(new Map(players.map((p) => [p.steamid, p.name])));

	$effect(() => {
		const list = sources;
		throws = [];
		blinds = [];
		loaded = 0;
		const collected: Throw[][] = [];
		const collectedBlinds: Blind[][] = [];
		return loadRounds(list, (replay, index) => {
			loaded++;
			if (!replay) return;
			const { meta } = replay;
			collected[index] = meta.grenades.flatMap((grenade): Throw[] => {
				const thrower = meta.players[grenade.thrower];
				const path = grenade.path;
				if (!thrower || path.length < 8) return [];
				const last = path.length - 4;
				return [
					{
						demoId: list[index]!.demoId,
						round: meta.round,
						type: grenade.type,
						steamid: thrower.steamid,
						side: thrower.side,
						tick: path[0]!,
						from: { x: path[1]!, y: path[2]!, z: path[3]! },
						to: { x: path[last + 1]!, y: path[last + 2]!, z: path[last + 3]! },
						setpos: setposCommand(replay, grenade.thrower, path[0]!)
					}
				];
			});
			collectedBlinds[index] = meta.blinds.flatMap((blind): Blind[] => {
				const attacker = meta.players[blind.attacker];
				const victim = meta.players[blind.player];
				if (!attacker || !victim || blind.attacker === blind.player) return [];
				return [
					{
						attacker: attacker.steamid,
						victim: victim.steamid,
						duration: blind.duration,
						team: attacker.team === victim.team
					}
				];
			});
			throws = collected.flat();
			blinds = collectedBlinds.flat();
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

	const visible = $derived(
		throws.filter(
			(t) =>
				types.includes(t.type) &&
				(!player || t.steamid === player) &&
				(side === 'all' || t.side === side) &&
				(!hasLower || t.to.z < info!.lowerBelowZ! === (level === 'lower'))
		)
	);
	const counts = $derived(
		Object.fromEntries(
			(Object.keys(typeLabels) as GrenadeType[]).map((type) => [
				type,
				throws.filter(
					(t) =>
						t.type === type &&
						(!player || t.steamid === player) &&
						(side === 'all' || t.side === side)
				).length
			])
		) as Record<GrenadeType, number>
	);

	const table = $derived(
		players
			.map((p) => {
				const own = throws.filter((t) => t.steamid === p.steamid);
				const count = (type: GrenadeType) => own.filter((t) => t.type === type).length;
				const enemies = blinds.filter((b) => b.attacker === p.steamid && !b.team);
				const team = blinds.filter((b) => b.attacker === p.steamid && b.team);
				const flashes = count('flash');
				return {
					...p,
					smoke: count('smoke'),
					flash: flashes,
					he: count('he'),
					molotov: count('molotov'),
					enemies: enemies.length,
					perFlash: flashes ? enemies.length / flashes : 0,
					blindTime: enemies.reduce((sum, b) => sum + b.duration, 0),
					team: team.length
				};
			})
			.sort((a, b) => b.smoke + b.flash + b.he + b.molotov - (a.smoke + a.flash + a.he + a.molotov))
	);
	const bothSides = $derived(new Set(throws.map((t) => t.side)).size > 1);
	const image = $derived(level === 'lower' && lowerRadar ? lowerRadar : radar);

	function project(size: number, x: number, y: number) {
		const { u, v } = worldToRadar(info!, image!.naturalWidth, x, y);
		return { px: u * size, py: v * size };
	}

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
		const dot = Math.max(3, size / 170);
		for (const item of visible) {
			const from = project(size, item.from.x, item.from.y);
			const to = project(size, item.to.x, item.to.y);
			ctx.globalAlpha = player ? 0.5 : 0.22;
			ctx.strokeStyle = typeColors[item.type];
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(from.px, from.py);
			ctx.lineTo(to.px, to.py);
			ctx.stroke();
			ctx.globalAlpha = 0.9;
			ctx.fillStyle = typeColors[item.type];
			ctx.strokeStyle = 'rgba(0,0,0,0.65)';
			ctx.beginPath();
			ctx.arc(to.px, to.py, item.type === 'smoke' ? dot * 1.4 : dot, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
		if (hover) {
			const from = project(size, hover.item.from.x, hover.item.from.y);
			ctx.globalAlpha = 1;
			ctx.fillStyle = '#fff';
			ctx.beginPath();
			ctx.arc(from.px, from.py, dot * 0.8, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
	});

	function nearest(event: MouseEvent) {
		if (!canvas || !image) return null;
		const rect = canvas.getBoundingClientRect();
		const mx = event.clientX - rect.left;
		const my = event.clientY - rect.top;
		let best: { item: Throw; left: number; top: number } | null = null;
		let bestDistance = 12 ** 2;
		for (const item of visible) {
			const { px, py } = project(rect.width, item.to.x, item.to.y);
			const distance = (px - mx) ** 2 + (py - my) ** 2;
			if (distance < bestDistance) {
				bestDistance = distance;
				best = { item, left: px, top: py };
			}
		}
		return best;
	}

	function watch(event: MouseEvent) {
		const hit = nearest(event);
		if (!hit) return;
		const hash = `round-${hit.item.round}@${Math.max(0, hit.item.tick - 128)}`;
		if (hit.item.demoId === currentDemo) location.hash = hash;
		else goto(`/demos/${hit.item.demoId}#${hash}`);
	}

	async function copyLineup(event: MouseEvent) {
		const hit = nearest(event);
		if (!hit?.item.setpos) return;
		event.preventDefault();
		try {
			await navigator.clipboard.writeText(hit.item.setpos);
			copied = hit.item.setpos;
		} catch {
			copied = hit.item.setpos;
		}
		setTimeout(() => (copied = null), 2500);
	}

	function toggleType(type: GrenadeType) {
		types = types.includes(type) ? types.filter((t) => t !== type) : [...types, type];
	}
</script>

<div class="utility">
	<div class="filters">
		{#each Object.keys(typeLabels) as GrenadeType[] as type (type)}
			<button
				type="button"
				class="type"
				aria-pressed={types.includes(type)}
				style:--type={typeColors[type]}
				onclick={() => toggleType(type)}
				><i></i>{typeLabels[type]} <small>{counts[type]}</small></button
			>
		{/each}
		{#if players.length > 1}
			<select bind:value={player} aria-label="Player">
				<option value="">Everyone</option>
				{#each players as p (p.steamid)}
					<option value={p.steamid}>{p.name}</option>
				{/each}
			</select>
		{/if}
		{#if bothSides}
			<div class="toggle" role="group" aria-label="Side">
				{#each ['all', 'CT', 'T'] as const as key (key)}
					<button type="button" aria-pressed={side === key} onclick={() => (side = key)}
						>{key === 'all' ? 'Both sides' : key}</button
					>
				{/each}
			</div>
		{/if}
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
			{loaded < sources.length
				? `Loading rounds ${loaded}/${sources.length}…`
				: `${visible.length} grenades`}
		</span>
	</div>

	{#if !info}
		<p class="hint">There is no radar calibration for this map, so grenades can't be drawn.</p>
	{:else}
		<div class="stage">
			<canvas
				bind:this={canvas}
				onmousemove={(event) => {
					const hit = nearest(event);
					hover = hit;
				}}
				onmouseleave={() => (hover = null)}
				onclick={watch}
				oncontextmenu={copyLineup}
				class:pointer={hover !== null}
			></canvas>
			{#if hover}
				<div class="tip" style="left: {hover.left}px; top: {hover.top}px">
					<b>{names.get(hover.item.steamid) ?? '?'} · {typeLabels[hover.item.type]}</b>
					<span
						>Round {hover.item.round} · click to watch the throw · right-click copies setpos</span
					>
				</div>
			{/if}
		</div>
		{#if loaded >= sources.length && throws.length}
			<div class="stats">
				<table>
					<thead>
						<tr>
							<th class="name">Player</th>
							<th>Smokes</th>
							<th>Flashes</th>
							<th>HE</th>
							<th>Molotovs</th>
							<th title="Enemies blinded by this player's flashes">Enemies flashed</th>
							<th title="Enemies blinded per flash thrown">Per flash</th>
							<th title="Total seconds enemies spent blinded">Blind time</th>
							<th title="Teammates blinded">Team flashed</th>
						</tr>
					</thead>
					<tbody>
						{#each table as row (row.steamid)}
							<tr class:on={player === row.steamid}>
								<td class="name">
									{#if players.length > 1}
										<button
											type="button"
											onclick={() => (player = player === row.steamid ? '' : row.steamid)}
											>{row.name}</button
										>
									{:else}{row.name}{/if}
								</td>
								<td>{row.smoke}</td>
								<td>{row.flash}</td>
								<td>{row.he}</td>
								<td>{row.molotov}</td>
								<td>{row.enemies}</td>
								<td>{row.flash ? row.perFlash.toFixed(1) : '–'}</td>
								<td>{row.blindTime.toFixed(1)} s</td>
								<td class:bad={row.team > row.enemies / 2 && row.team > 1}>{row.team}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		<p class="hint">
			{copied
				? `Copied: ${copied}`
				: 'Dots are where grenades landed, lines lead back to where they were thrown (white dot on hover).'}
		</p>
	{/if}
</div>

<style>
	.utility {
		display: grid;
		gap: 12px;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.type {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}

	.type[aria-pressed='true'] {
		color: var(--text);
		background: var(--surface-2);
	}

	.type i {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--type);
		opacity: 0.4;
	}

	.type[aria-pressed='true'] i {
		opacity: 1;
	}

	.type small {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
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

	.stats {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9em;
		font-variant-numeric: tabular-nums;
	}

	th,
	td {
		padding: 6px 10px;
		text-align: right;
		white-space: nowrap;
	}

	th {
		color: var(--muted);
		font-weight: 600;
		font-size: 0.85em;
	}

	.name {
		text-align: left;
	}

	tbody tr {
		border-top: 1px solid var(--border);
	}

	tbody tr.on {
		background: var(--surface-2);
	}

	td.name button {
		all: unset;
		cursor: pointer;
		font-weight: 600;
	}

	td.name button:hover {
		text-decoration: underline;
	}

	td.bad {
		color: var(--danger);
	}

	.hint {
		margin: 0;
		color: var(--muted);
		font-size: 0.85em;
		text-align: center;
		overflow-wrap: anywhere;
	}
</style>
