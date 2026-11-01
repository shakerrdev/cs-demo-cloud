import {
	FLAG_ALIVE,
	FLAG_BOMB,
	FLAG_DEFUSER,
	FLAG_DEFUSING,
	FLAG_DUCKING,
	FLAG_HELMET,
	FLAG_PRESENT,
	FLAG_SCOPED,
	PUNCH_SCALE,
	VIEW_POSITION_SCALE,
	lerpAngle,
	unpackPitch,
	unpackYaw,
	type ReplayPlayer,
	type RoundReplay
} from '@cs-demo-cloud/replay';

export interface PlayerState extends ReplayPlayer {
	index: number;
	x: number;
	y: number;
	z: number;
	yaw: number;
	pitch: number;
	health: number;
	armor: number;
	helmet: boolean;
	defuser: boolean;
	defusing: boolean;
	bomb: boolean;
	alive: boolean;
	present: boolean;
	ducking: boolean;
	scoped: boolean;
	weapon: string;
	money: number;
	blind: number;
	kills: number;
	clip: number | null;
	reserve: number | null;
	zoom: number;
	place: string;
}

export function lastTick(replay: RoundReplay): number {
	return replay.meta.startTick + (replay.meta.frameCount - 1) * replay.meta.tickStep;
}

export function framePosition(replay: RoundReplay, tick: number) {
	const { startTick, tickStep, frameCount } = replay.meta;
	const position = Math.max(0, Math.min(frameCount - 1, (tick - startTick) / tickStep));
	const i0 = Math.floor(position);
	const i1 = Math.min(frameCount - 1, i0 + 1);
	return { i0, i1, t: position - i0, nearest: position - i0 < 0.5 ? i0 : i1 };
}

export function playerStates(replay: RoundReplay, tick: number): PlayerState[] {
	const { meta, columns } = replay;
	const { i0, i1, t, nearest } = framePosition(replay, tick);
	const n = meta.frameCount;

	return meta.players.map((player, p) => {
		const a = p * n + i0;
		const b = p * n + i1;
		const c = p * n + nearest;
		const flags = columns.flags[c]!;
		const blind = meta.blinds.reduce((remaining, blind) => {
			if (blind.player !== p || blind.tick > tick) return remaining;
			const left = blind.duration - (tick - blind.tick) / meta.tickRate;
			return Math.max(remaining, left > 0 ? Math.min(1, left / Math.min(blind.duration, 2)) : 0);
		}, 0);

		return {
			...player,
			index: p,
			x: columns.x[a]! + (columns.x[b]! - columns.x[a]!) * t,
			y: columns.y[a]! + (columns.y[b]! - columns.y[a]!) * t,
			z: columns.z[a]! + (columns.z[b]! - columns.z[a]!) * t,
			yaw: lerpAngle(unpackYaw(columns.yaw[a]!), unpackYaw(columns.yaw[b]!), t),
			pitch: unpackPitch(columns.pitch[a]! + (columns.pitch[b]! - columns.pitch[a]!) * t),
			health: columns.health[c]!,
			armor: columns.armor[c]!,
			helmet: (flags & FLAG_HELMET) !== 0,
			defuser: (flags & FLAG_DEFUSER) !== 0,
			defusing: (flags & FLAG_DEFUSING) !== 0,
			bomb: (flags & FLAG_BOMB) !== 0,
			alive: (flags & FLAG_ALIVE) !== 0,
			present: (flags & FLAG_PRESENT) !== 0,
			ducking: (flags & FLAG_DUCKING) !== 0,
			scoped: (flags & FLAG_SCOPED) !== 0,
			weapon: meta.weapons[columns.weapon[c]!] ?? '',
			money: columns.money[c]!,
			blind,
			clip: columns.clip ? columns.clip[c]! : null,
			reserve: columns.reserve ? columns.reserve[c]! : null,
			zoom: columns.zoom ? columns.zoom[c]! : 0,
			place: columns.place ? (meta.places?.[columns.place[c]!] ?? '') : '',
			kills: meta.kills.filter(
				(kill) => kill.attacker === p && kill.tick <= tick && kill.victim !== p
			).length
		};
	});
}

export function grenadePosition(path: number[], tick: number) {
	const points = path.length / 4;
	if (points === 0 || tick < path[0]! || tick > path[(points - 1) * 4]!) return null;
	for (let i = 0; i < points - 1; i++) {
		const t0 = path[i * 4]!;
		const t1 = path[(i + 1) * 4]!;
		if (tick < t0 || tick > t1) continue;
		const t = t1 === t0 ? 0 : (tick - t0) / (t1 - t0);
		return {
			x: path[i * 4 + 1]! + (path[(i + 1) * 4 + 1]! - path[i * 4 + 1]!) * t,
			y: path[i * 4 + 2]! + (path[(i + 1) * 4 + 2]! - path[i * 4 + 2]!) * t,
			z: path[i * 4 + 3]! + (path[(i + 1) * 4 + 3]! - path[i * 4 + 3]!) * t,
			segment: i
		};
	}
	return {
		x: path[(points - 1) * 4 + 1]!,
		y: path[(points - 1) * 4 + 2]!,
		z: path[(points - 1) * 4 + 3]!,
		segment: points - 1
	};
}

export function bombState(replay: RoundReplay, tick: number) {
	let state: {
		kind: 'planted' | 'dropped' | 'defused' | 'exploded';
		x: number;
		y: number;
		z: number;
		tick: number;
		site: string | null;
	} | null = null;
	for (const event of replay.meta.bomb) {
		if (event.tick > tick) break;
		if (event.type === 'plant') state = { kind: 'planted', ...event };
		else if (event.type === 'drop') state = { kind: 'dropped', ...event };
		else if (event.type === 'pickup') state = null;
		else if (event.type === 'defuse') state = { kind: 'defused', ...event };
		else if (event.type === 'explode') state = { kind: 'exploded', ...event };
	}
	return state;
}

export interface Motion {
	speed: number;
	direction: number;
	vertical: number;
	distance: number;
}

const motionCache = new WeakMap<RoundReplay, Float32Array>();

function distances(replay: RoundReplay): Float32Array {
	let cached = motionCache.get(replay);
	if (cached) return cached;
	const { meta, columns } = replay;
	const n = meta.frameCount;
	cached = new Float32Array(meta.players.length * n);
	for (let p = 0; p < meta.players.length; p++) {
		let total = 0;
		for (let i = 1; i < n; i++) {
			const a = p * n + i - 1;
			const b = a + 1;
			const step = Math.hypot(columns.x[b]! - columns.x[a]!, columns.y[b]! - columns.y[a]!);
			if (step < 200) total += step;
			cached[b] = total;
		}
	}
	motionCache.set(replay, cached);
	return cached;
}

export function playerMotion(replay: RoundReplay, index: number, tick: number): Motion {
	const { meta, columns } = replay;
	const n = meta.frameCount;
	const position = Math.max(0, Math.min(n - 1, (tick - meta.startTick) / meta.tickStep));
	const i0 = Math.max(0, Math.min(n - 2, Math.floor(position)));
	const t = Math.min(1, position - i0);
	const a = index * n + Math.max(0, i0 - 1);
	const b = index * n + Math.min(n - 1, i0 + 2);
	const span = ((Math.min(n - 1, i0 + 2) - Math.max(0, i0 - 1)) * meta.tickStep) / meta.tickRate;
	const dx = span > 0 ? (columns.x[b]! - columns.x[a]!) / span : 0;
	const dy = span > 0 ? (columns.y[b]! - columns.y[a]!) / span : 0;
	const dz = span > 0 ? (columns.z[b]! - columns.z[a]!) / span : 0;
	const dist = distances(replay);
	const d0 = dist[index * n + i0]!;
	const d1 = dist[index * n + i0 + 1]!;
	const speed = Math.hypot(dx, dy);
	return {
		speed: speed > 600 ? 0 : speed,
		direction: Math.atan2(dy, dx),
		vertical: Math.abs(dz) > 1200 ? 0 : dz,
		distance: d0 + (d1 - d0) * t
	};
}

export interface ViewState {
	x: number;
	y: number;
	z: number;
	yaw: number;
	pitch: number;
	punchPitch: number;
	punchYaw: number;
	duck: number;
}

export function viewState(replay: RoundReplay, index: number, tick: number): ViewState | null {
	const { meta, view } = replay;
	if (!view || !meta.view || index < 0 || index >= meta.players.length) return null;
	const { startTick, tickStep, frameCount } = meta.view;
	const position = Math.max(0, Math.min(frameCount - 1, (tick - startTick) / tickStep));
	const i0 = Math.floor(position);
	const i1 = Math.min(frameCount - 1, i0 + 1);
	const t = position - i0;
	const a = index * frameCount + i0;
	const b = index * frameCount + i1;
	const lerp = (column: ArrayLike<number>) => column[a]! + (column[b]! - column[a]!) * t;
	return {
		x: lerp(view.x) / VIEW_POSITION_SCALE,
		y: lerp(view.y) / VIEW_POSITION_SCALE,
		z: lerp(view.z) / VIEW_POSITION_SCALE,
		yaw: lerpAngle(unpackYaw(view.yaw[a]!), unpackYaw(view.yaw[b]!), t),
		pitch: unpackPitch(lerp(view.pitch)),
		punchPitch: lerp(view.punchPitch) / PUNCH_SCALE,
		punchYaw: lerp(view.punchYaw) / PUNCH_SCALE,
		duck: lerp(view.duck) / 255
	};
}

export function inventoryAt(replay: RoundReplay, index: number, tick: number): string[] {
	const list = replay.meta.inventory;
	if (!list) return [];
	let found: number[] = [];
	for (let i = 0; i < list.length;) {
		const at = list[i]!;
		const player = list[i + 1]!;
		const count = list[i + 2]!;
		if (at > tick) break;
		if (player === index) found = list.slice(i + 3, i + 3 + count);
		i += 3 + count;
	}
	return found.map((weapon) => replay.meta.weapons[weapon] ?? '').filter(Boolean);
}

export function setposCommand(replay: RoundReplay, index: number, tick: number): string | null {
	const view = viewState(replay, index, tick);
	const state = playerStates(replay, tick)[index];
	if (!state) return null;
	const x = view?.x ?? state.x;
	const y = view?.y ?? state.y;
	const z = view?.z ?? state.z;
	const pitch = view?.pitch ?? state.pitch;
	const yaw = view?.yaw ?? state.yaw;
	const n = (value: number) => (Math.round(value * 100) / 100).toString();
	return `setpos ${n(x)} ${n(y)} ${n(z)};setang ${n(pitch)} ${n(yaw)} 0`;
}

export function observerSlots(players: PlayerState[]): Map<number, number> {
	const slots = new Map<number, number>();
	let next = 1;
	for (const side of ['CT', 'T'] as const) {
		for (const player of players
			.filter((p) => p.present && p.side === side)
			.sort((a, b) => a.index - b.index)) {
			if (next > 10) break;
			slots.set(player.index, next++);
		}
	}
	return slots;
}

export const slotLabel = (slot: number) => String(slot % 10);

export const DIRECTOR_LOOKAHEAD_SECONDS = 4;

export function directorPick(
	replay: RoundReplay,
	tick: number,
	current: number | null
): number | null {
	const players = playerStates(replay, tick);
	const alive = (index: number) => index >= 0 && players[index]?.alive === true;
	const horizon = tick + DIRECTOR_LOOKAHEAD_SECONDS * replay.meta.tickRate;
	const upcoming = replay.meta.kills
		.filter((kill) => kill.tick > tick && alive(kill.attacker))
		.sort((a, b) => a.tick - b.tick);
	const soon = upcoming.find((kill) => kill.tick <= horizon);
	if (soon) return soon.attacker;
	if (current !== null && alive(current)) return current;
	if (upcoming[0]) return upcoming[0].attacker;
	return players.find((p) => p.alive && p.present)?.index ?? current;
}

export const DEFUSE_SECONDS = { kit: 5, none: 10 };

export function defuseProgress(
	replay: RoundReplay,
	player: PlayerState,
	tick: number
): { fraction: number; left: number } | null {
	if (!player.defusing) return null;
	const start = replay.meta.bomb.findLast(
		(event) => event.type === 'defuse_start' && event.player === player.index && event.tick <= tick
	);
	if (!start) return null;
	const total = player.defuser ? DEFUSE_SECONDS.kit : DEFUSE_SECONDS.none;
	const elapsed = (tick - start.tick) / replay.meta.tickRate;
	return { fraction: Math.min(1, elapsed / total), left: Math.max(0, total - elapsed) };
}

export interface RecentHurt {
	victim: number;
	attacker: number;
	damage: number;
	head: boolean;
	age: number;
}

export function recentHurts(replay: RoundReplay, tick: number, seconds = 1.2): RecentHurt[] {
	const hurts = replay.meta.hurts;
	if (!hurts) return [];
	const rate = replay.meta.tickRate;
	const list: RecentHurt[] = [];
	for (let i = 0; i + 5 < hurts.length; i += 6) {
		const at = hurts[i]!;
		if (at > tick) break;
		const age = (tick - at) / rate;
		if (age > seconds) continue;
		const damage = hurts[i + 3]!;
		if (damage <= 0) continue;
		list.push({
			victim: hurts[i + 1]!,
			attacker: hurts[i + 2]!,
			damage,
			head: hurts[i + 5] === 1,
			age
		});
	}
	return list;
}
