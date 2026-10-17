<script lang="ts">
	import {
		weaponClass,
		weaponKey,
		weaponTitle,
		type MapInfo,
		type RoundReplay,
		type Side,
		type TeamKey
	} from '@cs-demo-cloud/replay';
	import { drawFrame, sideColors } from './draw.ts';
	import { inventoryAt, type PlayerState } from './frame.ts';

	interface Props {
		replay: RoundReplay;
		tick: number;
		players: PlayerState[];
		focus: number | null;
		pov: boolean;
		teamNames: Record<TeamKey, string>;
		teamSides: Record<TeamKey, Side | null>;
		scores: Record<TeamKey, number>;
		clock: { label: string; time: string; bomb: boolean };
		map: MapInfo | null;
		radar: HTMLImageElement | null;
		lowerRadar: HTMLImageElement | null;
		pixelRatio: number;
		height: number;
		onSelect: (index: number) => void;
	}

	let {
		replay,
		tick,
		players,
		focus,
		pov,
		teamNames,
		teamSides,
		scores,
		clock,
		map,
		radar,
		lowerRadar,
		pixelRatio,
		height,
		onSelect
	}: Props = $props();

	const RADAR_SHARE = 0.26;
	const slotColors = ['#4fa3ff', '#4cd964', '#ffd23f', '#ff8a2b', '#b36bff'];
	const sides: Side[] = ['CT', 'T'];

	let radarCanvas = $state<HTMLCanvasElement | null>(null);
	const radarPx = $derived(Math.max(64, Math.round(height * RADAR_SHARE * pixelRatio)));

	const teamOn = (side: Side): TeamKey | null =>
		teamSides.a === side ? 'a' : teamSides.b === side ? 'b' : null;

	const roster = $derived(
		Object.fromEntries(
			sides.map((side) => [
				side,
				players.filter((p) => p.present && p.side === side).sort((a, b) => a.index - b.index)
			])
		) as Record<Side, PlayerState[]>
	);

	const colorOf = (player: PlayerState) => {
		const slot = roster[player.side].indexOf(player);
		return slotColors[slot % slotColors.length]!;
	};

	const focused = $derived(focus !== null ? (players[focus] ?? null) : null);
	const inventory = $derived(focused ? inventoryAt(replay, focused.index, tick) : []);
	const slots = $derived(slotList(inventory, focused?.weapon ?? ''));

	const killFeed = $derived.by(() => {
		const window = 7 * replay.meta.tickRate;
		return replay.meta.kills
			.filter((kill) => kill.tick <= tick && tick - kill.tick < window)
			.slice(-6);
	});

	const lower = $derived(
		map?.lowerBelowZ != null && focused?.alive && focused.z < map.lowerBelowZ && lowerRadar
			? 'lower'
			: 'upper'
	);

	$effect(() => {
		const canvas = radarCanvas;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		drawFrame({
			ctx,
			size: radarPx,
			pixelRatio: pixelRatio * 0.75,
			replay,
			tick,
			map,
			radar: lower === 'lower' ? lowerRadar : radar,
			level: lower,
			focus,
			labels: false
		});
	});

	function slotList(items: string[], active: string) {
		const order: Record<string, number> = { rifle: 1, pistol: 2, knife: 3, grenade: 4, c4: 5 };
		const list = items.map((name) => {
			const key = weaponKey(name);
			const kind = key === 'c4' || /c4/i.test(name) ? 'c4' : weaponClass(key);
			return { name, slot: order[kind] ?? 1, active: name === active };
		});
		return list.sort((a, b) => a.slot - b.slot);
	}

	function placeName(place: string): string {
		return place.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z])([A-Z0-9])/g, '$1 $2');
	}

	function shortWeapon(name: string): string {
		if (!name) return '';
		if (/knife|bayonet|karambit|dagger/i.test(name)) return 'Knife';
		return name.replace(/ Grenade$/, '').replace('Desert Eagle', 'Deagle');
	}

	function primaryOf(player: PlayerState): string {
		const items = inventoryAt(replay, player.index, tick);
		const guns = items.filter((name) => {
			const kind = weaponClass(weaponKey(name));
			return kind === 'rifle';
		});
		const pistol = items.find((name) => weaponClass(weaponKey(name)) === 'pistol');
		return shortWeapon(guns[0] ?? pistol ?? (items.length ? '' : player.weapon));
	}

	function utilityOf(player: PlayerState): number {
		return inventoryAt(replay, player.index, tick).filter(
			(name) => weaponClass(weaponKey(name)) === 'grenade'
		).length;
	}

	const alive = (side: Side) => roster[side].filter((p) => p.alive).length;
</script>

<div class="hud" class:pov style:--h="{height}px">
	<div class="radar">
		<canvas bind:this={radarCanvas} width={radarPx} height={radarPx} class="radar-map"></canvas>
		{#if focused?.alive && focused.place}<span class="place">{placeName(focused.place)}</span>{/if}
	</div>

	<div class="topbar">
		{#each sides as side, i (side)}
			{@const team = teamOn(side)}
			<div class="team" class:right={i === 1} style:--side={sideColors[side]}>
				{#each roster[side] as player (player.steamid)}
					<button
						type="button"
						class="pcard"
						class:dead={!player.alive}
						class:focused={player.index === focus}
						style:--slot={colorOf(player)}
						onclick={() => onSelect(player.index)}
						title={player.name}
					>
						<span class="pcard-name">{player.name}</span>
						<span class="pcard-face"
							><span class="pcard-hp" style:height="{player.alive ? player.health : 0}%"
							></span><span class="pcard-initial">{player.name.slice(0, 1).toUpperCase()}</span
							></span
						>
						<span class="pcard-money">${player.money}</span>
						<span class="pcard-gun">{player.alive ? primaryOf(player) : ''}</span>
						<span class="pcard-gear">
							{#if player.alive && player.armor > 0}<i class="gear">{player.helmet ? '⛑' : '◈'}</i
								>{/if}
							{#if player.alive && player.defuser}<i class="gear">✂</i>{/if}
							{#if player.alive && player.bomb}<i class="gear bomb">C4</i>{/if}
							{#if player.alive}{#each { length: utilityOf(player) } as _, u (u)}<i class="nade"
									></i>{/each}{/if}
						</span>
					</button>
				{/each}
				{#if team}<span class="team-name">{teamNames[team]}</span>{/if}
			</div>
			{#if i === 0}
				<div class="timer" class:bomb={clock.bomb}>
					<span class="time">{clock.bomb ? '' : clock.time}</span>
					{#if clock.bomb}<span class="bomb-icon" aria-label="Bomb planted">💣 {clock.time}</span
						>{/if}
					<span class="score">
						<b style:color={sideColors.CT}>{teamOn('CT') ? scores[teamOn('CT') as TeamKey] : 0}</b>
						<b style:color={sideColors.T}>{teamOn('T') ? scores[teamOn('T') as TeamKey] : 0}</b>
					</span>
					<span class="alive"><i>{alive('CT')}</i><i>{alive('T')}</i></span>
				</div>
			{/if}
		{/each}
	</div>

	<ol class="feed">
		{#each killFeed as kill (kill.tick + ':' + kill.victim)}
			{@const attacker = replay.meta.players[kill.attacker]}
			{@const victim = replay.meta.players[kill.victim]}
			<li class:mine={focus !== null && (kill.attacker === focus || kill.victim === focus)}>
				{#if kill.attackerBlind}<span class="tag">◐</span>{/if}
				{#if attacker && kill.attacker !== kill.victim}
					<span style:color={sideColors[attacker.side]}>{attacker.name}</span>
				{/if}
				{#if kill.flashAssist}<span class="tag">✺</span>{/if}
				<span class="weapon">{weaponTitle(kill.weapon)}</span>
				{#if kill.noScope}<span class="tag">⊘</span>{/if}
				{#if kill.throughSmoke}<span class="tag">☁</span>{/if}
				{#if kill.wallbang}<span class="tag">▥</span>{/if}
				{#if kill.headshot}<span class="tag hs">✛</span>{/if}
				{#if victim}<span style:color={sideColors[victim.side]}>{victim.name}</span>{/if}
			</li>
		{/each}
	</ol>

	{#if focused}
		<div class="money">${focused.money}</div>
		<div class="status" class:dead={!focused.alive}>
			<span class="armor"
				><i class="shield">{focused.helmet ? '⛑' : '◈'}</i>{focused.alive ? focused.armor : 0}</span
			>
			<span class="hp" class:low={focused.health <= 20}>{focused.alive ? focused.health : 0}</span>
			<span class="divider"></span>
			<span class="who" style:--side={sideColors[focused.side]}>{focused.name}</span>
			<span class="divider"></span>
			<span class="gun">{focused.alive ? focused.weapon : 'Dead'}</span>
			{#if focused.alive && focused.clip !== null && weaponClass(weaponKey(focused.weapon)) !== 'knife'}
				<span class="ammo"
					><b>{focused.clip}</b><span class="sep">|</span><span>{focused.reserve ?? 0}</span></span
				>
			{/if}
		</div>
		{#if focused.alive && slots.length}
			<ul class="slots">
				{#each slots as item, s (item.name + s)}
					<li class:active={item.active}>
						<span>{shortWeapon(item.name)}</span><small>{item.slot}</small>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.hud {
		position: absolute;
		inset: 0;
		pointer-events: none;
		font-family: 'Barlow Semi Condensed', 'Roboto Condensed', 'Arial Narrow', system-ui, sans-serif;
		color: #f2f4f6;
		text-shadow: 0 0.06em 0.12em rgb(0 0 0 / 0.7);
		font-size: clamp(7px, calc(var(--h) * 0.0175), 26px);
	}

	.radar {
		position: absolute;
		top: 0.5em;
		left: 0.5em;
		display: grid;
		justify-items: center;
		gap: 0.1875em;
	}

	.radar canvas {
		width: calc(var(--h) * 0.26);
		height: calc(var(--h) * 0.26);
		border: 1px solid rgb(255 255 255 / 0.18);
		background: rgb(10 14 18 / 0.6);
		opacity: 0.92;
	}

	.place {
		font-size: 0.75em;
		font-weight: 600;
		color: #d9dee4;
	}

	.topbar {
		position: absolute;
		top: 0.375em;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: flex-start;
		gap: 0.25em;
	}

	.team {
		position: relative;
		display: flex;
		gap: 0.1875em;
	}

	.team-name {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 0.125em;
		font-size: 0.6875em;
		font-weight: 700;
		color: var(--side);
		white-space: nowrap;
	}

	.team.right .team-name {
		left: auto;
		right: 0;
	}

	.pcard {
		display: grid;
		justify-items: center;
		width: 3.3em;
		align-content: start;
		padding: 0 0 0.1875em;
		border: 0;
		border-top: 0.1875em solid var(--slot);
		background: linear-gradient(rgb(28 32 38 / 0.85), rgb(28 32 38 / 0.55));
		color: inherit;
		font: inherit;
		pointer-events: auto;
		cursor: pointer;
	}

	.pcard.focused {
		background: linear-gradient(rgb(110 116 124 / 0.9), rgb(60 64 70 / 0.65));
	}

	.pcard.dead {
		opacity: 0.45;
		filter: grayscale(1);
	}

	.pcard-name {
		width: 100%;
		overflow: hidden;
		padding: 1px 0.125em 0;
		font-size: 0.5938em;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: rgb(0 0 0 / 0.55);
	}

	.pcard-face {
		position: relative;
		display: grid;
		place-items: center;
		width: 2.125em;
		height: 1.875em;
		margin: 0.1875em 0 0.125em;
		border: 0.125em solid var(--slot);
		background: rgb(0 0 0 / 0.55);
		overflow: hidden;
	}

	.pcard-hp {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		background: color-mix(in srgb, var(--side) 45%, transparent);
	}

	.pcard-initial {
		position: relative;
		font-size: 0.9375em;
		font-weight: 700;
	}

	.pcard-money {
		font-size: 0.6875em;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.pcard-gun {
		width: 100%;
		min-height: 0.8125em;
		overflow: hidden;
		font-size: 0.5938em;
		color: #cdd3da;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pcard-gear {
		display: flex;
		gap: 0.125em;
		align-items: center;
		min-height: 0.6875em;
		font-size: 0.5625em;
	}

	.gear {
		font-style: normal;
		color: #d6dbe1;
	}

	.gear.bomb {
		color: #ff5a4f;
		font-weight: 700;
	}

	.nade {
		width: 0.25em;
		height: 0.4375em;
		border-radius: 0.125em;
		background: #d6dbe1;
	}

	.timer {
		display: grid;
		justify-items: center;
		min-width: 3.875em;
		padding: 0.125em 0.375em 0.25em;
		background: linear-gradient(rgb(20 24 30 / 0.92), rgb(20 24 30 / 0.7));
		font-variant-numeric: tabular-nums;
	}

	.timer .time {
		font-size: 1.375em;
		font-weight: 700;
		line-height: 1.1;
	}

	.timer.bomb .bomb-icon {
		font-size: 0.9375em;
		font-weight: 700;
		line-height: 1.6;
		color: #ff5a4f;
	}

	.score {
		display: flex;
		gap: 0.75em;
		font-size: 1.0625em;
	}

	.alive {
		display: flex;
		gap: 1em;
		font-size: 0.625em;
		color: #aab2bb;
	}

	.alive i {
		font-style: normal;
	}

	.feed {
		position: absolute;
		top: 0.625em;
		right: 0.625em;
		display: grid;
		justify-items: end;
		gap: 0.1875em;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.feed li {
		display: flex;
		align-items: center;
		gap: 0.4375em;
		padding: 0.1875em 0.5625em;
		border: 0.125em solid transparent;
		border-radius: 0.1875em;
		background: rgb(0 0 0 / 0.55);
		font-size: 0.8125em;
		font-weight: 700;
		white-space: nowrap;
	}

	.feed li.mine {
		border-color: #e0322b;
		background: rgb(30 0 0 / 0.6);
	}

	.feed .weapon {
		color: #f2f4f6;
		font-weight: 500;
	}

	.feed .tag {
		color: #e7ebef;
		font-weight: 500;
	}

	.money {
		position: absolute;
		left: 1.125em;
		bottom: 0.875em;
		font-size: 1.125em;
		font-weight: 700;
		color: #e8f3e2;
		font-variant-numeric: tabular-nums;
	}

	.status {
		position: absolute;
		left: 50%;
		bottom: 0.5em;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.75em;
		padding: 0.3125em 0.875em;
		background: linear-gradient(
			90deg,
			rgb(0 0 0 / 0),
			rgb(0 0 0 / 0.55) 15%,
			rgb(0 0 0 / 0.55) 85%,
			rgb(0 0 0 / 0)
		);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.status.dead {
		opacity: 0.6;
	}

	.armor {
		display: flex;
		align-items: center;
		gap: 0.25em;
		font-size: 0.9375em;
		color: #cfd5dc;
	}

	.shield {
		font-style: normal;
		font-size: 0.8125em;
	}

	.hp {
		font-size: 1.375em;
		font-weight: 700;
		text-decoration: underline;
		text-decoration-thickness: 0.125em;
		text-underline-offset: 0.1875em;
	}

	.hp.low {
		color: #ff4a3d;
	}

	.divider {
		width: 1px;
		height: 1.375em;
		background: rgb(255 255 255 / 0.3);
	}

	.who {
		min-width: 5.625em;
		font-size: 0.8125em;
		font-weight: 600;
		color: var(--side);
	}

	.gun {
		font-size: 0.75em;
		color: #dfe4ea;
	}

	.ammo {
		display: flex;
		align-items: baseline;
		gap: 0.375em;
		font-size: 0.8125em;
		color: #c6ccd3;
	}

	.ammo b {
		font-size: 1.375em;
		color: #f2f4f6;
	}

	.ammo .sep {
		color: rgb(255 255 255 / 0.35);
	}

	.slots {
		position: absolute;
		right: 0.875em;
		bottom: 3.5em;
		display: grid;
		justify-items: end;
		gap: 0.375em;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.slots li {
		display: flex;
		align-items: baseline;
		gap: 0.375em;
		font-size: 0.75em;
		font-weight: 600;
		color: rgb(220 226 232 / 0.55);
	}

	.slots li.active {
		color: #f4f7fa;
	}

	.slots small {
		font-size: 0.5625em;
		color: rgb(220 226 232 / 0.5);
	}
</style>
