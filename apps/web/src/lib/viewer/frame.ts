import {
	FLAG_ALIVE,
	FLAG_BOMB,
	FLAG_DEFUSER,
	FLAG_DEFUSING,
	FLAG_HELMET,
	FLAG_PRESENT,
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
	weapon: string;
	money: number;
	blind: number;
	kills: number;
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
			pitch: unpackPitch(columns.pitch[c]!),
			health: columns.health[c]!,
			armor: columns.armor[c]!,
			helmet: (flags & FLAG_HELMET) !== 0,
			defuser: (flags & FLAG_DEFUSER) !== 0,
			defusing: (flags & FLAG_DEFUSING) !== 0,
			bomb: (flags & FLAG_BOMB) !== 0,
			alive: (flags & FLAG_ALIVE) !== 0,
			present: (flags & FLAG_PRESENT) !== 0,
			weapon: meta.weapons[columns.weapon[c]!] ?? '',
			money: columns.money[c]!,
			blind,
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
