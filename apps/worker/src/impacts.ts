import {
	BULLET_STRIDE,
	FLAG_DUCKING,
	IMPACT_BLOOD,
	IMPACT_FLESH,
	IMPACT_MISS,
	IMPACT_WALL,
	type RoundReplay
} from '@cs-demo-cloud/replay';
import type { MeshRaycaster } from './raycast.ts';

const RANGE = 8192;
const BLOOD_RANGE = 180;
const HIT_RADIUS = 40;

type Vec = [number, number, number];

function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function bulletDirections(
	pitch: number,
	yaw: number,
	inaccuracy: number,
	spread: number,
	seed: number,
	pellets: number
): Vec[] {
	const p = (pitch * Math.PI) / 180;
	const y = (yaw * Math.PI) / 180;
	const forward: Vec = [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)];
	const right: Vec = [Math.sin(y), -Math.cos(y), 0];
	const up: Vec = [Math.sin(p) * Math.cos(y), Math.sin(p) * Math.sin(y), Math.cos(p)];
	const next = random(seed);
	const theta0 = next() * Math.PI * 2;
	const radius0 = next() * inaccuracy;
	const out: Vec[] = [];
	for (let i = 0; i < pellets; i++) {
		const theta1 = next() * Math.PI * 2;
		const radius1 = next() * spread;
		const sx = Math.cos(theta0) * radius0 + Math.cos(theta1) * radius1;
		const sy = Math.sin(theta0) * radius0 + Math.sin(theta1) * radius1;
		const d: Vec = [
			forward[0] + sx * right[0] + sy * up[0],
			forward[1] + sx * right[1] + sy * up[1],
			forward[2] + sx * right[2] + sy * up[2]
		];
		const length = Math.hypot(...d);
		out.push([d[0] / length, d[1] / length, d[2] / length]);
	}
	return out;
}

interface Hurt {
	tick: number;
	victim: number;
	attacker: number;
	head: boolean;
	used: boolean;
}

function victimPoint(replay: RoundReplay, victim: number, tick: number, head: boolean): Vec | null {
	const { meta, columns } = replay;
	const frame = Math.round((tick - meta.startTick) / meta.tickStep);
	if (frame < 0 || frame >= meta.frameCount) return null;
	const i = victim * meta.frameCount + frame;
	const ducking = (columns.flags[i]! & FLAG_DUCKING) !== 0;
	const height = head ? (ducking ? 46 : 62) : ducking ? 32 : 44;
	return [columns.x[i]!, columns.y[i]!, columns.z[i]! + height];
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function computeImpacts(replay: RoundReplay, raycaster: MeshRaycaster | null): number[] {
	const bullets = replay.meta.bullets ?? [];
	const hurtsRaw = replay.meta.hurts ?? [];
	const hurts: Hurt[] = [];
	for (let i = 0; i + 5 < hurtsRaw.length; i += 6)
		hurts.push({
			tick: hurtsRaw[i]!,
			victim: hurtsRaw[i + 1]!,
			attacker: hurtsRaw[i + 2]!,
			head: hurtsRaw[i + 5] === 1,
			used: false
		});

	const impacts: number[] = [];
	const push = (tick: number, player: number, point: Vec, normal: Vec, kind: number) =>
		impacts.push(
			tick,
			player,
			round1(point[0]),
			round1(point[1]),
			round1(point[2]),
			round2(normal[0]),
			round2(normal[1]),
			round2(normal[2]),
			kind
		);

	for (let b = 0; b + BULLET_STRIDE - 1 < bullets.length; b += BULLET_STRIDE) {
		const tick = bullets[b]!;
		const player = bullets[b + 1]!;
		const origin: Vec = [bullets[b + 2]!, bullets[b + 3]!, bullets[b + 4]!];
		const directions = bulletDirections(
			bullets[b + 5]!,
			bullets[b + 6]!,
			bullets[b + 7]!,
			bullets[b + 8]!,
			bullets[b + 9]!,
			bullets[b + 10]!
		);
		for (const direction of directions) {
			const hit = raycaster?.cast(origin, direction, RANGE) ?? null;
			const wall = hit ? hit.distance : RANGE;
			const hurt = hurts.find((h) => {
				if (h.used || h.attacker !== player || Math.abs(h.tick - tick) > 2) return false;
				const point = victimPoint(replay, h.victim, h.tick, h.head);
				if (!point) return false;
				const along =
					(point[0] - origin[0]) * direction[0] +
					(point[1] - origin[1]) * direction[1] +
					(point[2] - origin[2]) * direction[2];
				if (along <= 0 || along > wall + 64) return false;
				const off = Math.hypot(
					origin[0] + direction[0] * along - point[0],
					origin[1] + direction[1] * along - point[1],
					origin[2] + direction[2] * along - point[2]
				);
				return off < HIT_RADIUS;
			});
			const at = (distance: number): Vec => [
				origin[0] + direction[0] * distance,
				origin[1] + direction[1] * distance,
				origin[2] + direction[2] * distance
			];
			const back: Vec = [-direction[0], -direction[1], -direction[2]];
			if (hurt) {
				hurt.used = true;
				const point = victimPoint(replay, hurt.victim, hurt.tick, hurt.head)!;
				const along =
					(point[0] - origin[0]) * direction[0] +
					(point[1] - origin[1]) * direction[1] +
					(point[2] - origin[2]) * direction[2];
				push(tick, player, at(along), back, IMPACT_FLESH);
				if (hit && hit.distance > along && hit.distance - along < BLOOD_RANGE)
					push(tick, player, at(hit.distance), hit.normal, IMPACT_BLOOD);
				continue;
			}
			if (hit) push(tick, player, at(hit.distance), hit.normal, IMPACT_WALL);
			else push(tick, player, at(RANGE), back, IMPACT_MISS);
		}
	}
	return impacts;
}
