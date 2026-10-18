import type { ReplayEffect, RoundReplay, SmokeVolume } from '@cs-demo-cloud/replay';
import type { MeshRaycaster } from './raycast.ts';

export const SMOKE_CELL = 20;
const REACH = 16;
const LAYERS = 11;
const BELOW = 2;
const BUDGET = 1050;
const UP_COST = 1.3;
const DOWN_COST = 0.7;

type Vec = [number, number, number];

const NEIGHBORS: [number, number, number, number][] = [
	[1, 0, 0, 1],
	[-1, 0, 0, 1],
	[0, 1, 0, 1],
	[0, -1, 0, 1],
	[0, 0, 1, UP_COST],
	[0, 0, -1, DOWN_COST]
];

export function smokeVolume(effect: ReplayEffect, raycaster: MeshRaycaster): SmokeVolume {
	const nx = REACH * 2 + 1;
	const ny = nx;
	const nz = LAYERS;
	const origin: Vec = [effect.x, effect.y, effect.z + SMOKE_CELL * 0.6];
	const min: Vec = [
		origin[0] - REACH * SMOKE_CELL - SMOKE_CELL / 2,
		origin[1] - REACH * SMOKE_CELL - SMOKE_CELL / 2,
		origin[2] - BELOW * SMOKE_CELL - SMOKE_CELL / 2
	];
	const center = (x: number, y: number, z: number): Vec => [
		min[0] + (x + 0.5) * SMOKE_CELL,
		min[1] + (y + 0.5) * SMOKE_CELL,
		min[2] + (z + 0.5) * SMOKE_CELL
	];
	const index = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
	const cost = new Float32Array(nx * ny * nz).fill(Infinity);
	const done = new Uint8Array(nx * ny * nz);
	const start = index(REACH, REACH, BELOW);
	cost[start] = 0;
	const open = [start];
	const cells: number[] = [];

	while (open.length && cells.length < BUDGET) {
		let best = 0;
		for (let i = 1; i < open.length; i++) if (cost[open[i]!]! < cost[open[best]!]!) best = i;
		const cell = open[best]!;
		open[best] = open[open.length - 1]!;
		open.pop();
		if (done[cell]) continue;
		done[cell] = 1;
		cells.push(cell);
		const x = cell % nx;
		const y = Math.floor(cell / nx) % ny;
		const z = Math.floor(cell / (nx * ny));
		const from = center(x, y, z);
		for (const [dx, dy, dz, step] of NEIGHBORS) {
			const X = x + dx;
			const Y = y + dy;
			const Z = z + dz;
			if (X < 1 || Y < 1 || Z < 1 || X >= nx - 1 || Y >= ny - 1 || Z >= nz - 1) continue;
			const next = index(X, Y, Z);
			if (done[next]) continue;
			const total = cost[cell]! + step;
			if (total >= cost[next]!) continue;
			const hit = raycaster.cast(from, [dx, dy, dz], SMOKE_CELL * 1.25);
			if (hit) continue;
			cost[next] = total;
			open.push(next);
		}
	}
	return { min: min.map((v) => Math.round(v)) as Vec, cell: SMOKE_CELL, dims: [nx, ny, nz], cells };
}

export function computeSmokeVolumes(replay: RoundReplay, raycaster: MeshRaycaster): void {
	for (const effect of replay.meta.effects)
		if (effect.type === 'smoke') effect.volume = smokeVolume(effect, raycaster);
}
