import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quantizeMesh, type ReplayEffect } from '@cs-demo-cloud/replay';
import { MeshRaycaster } from './raycast.ts';
import { smokeVolume } from './smokes.ts';

function room(): MeshRaycaster {
	const vertices = new Float32Array([
		-1000, -1000, 0, 1000, -1000, 0, 1000, 1000, 0, -1000, 1000, 0, 50, -1000, 0, 50, 1000, 0, 50,
		1000, 1000, 50, -1000, 1000
	]);
	const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
	return new MeshRaycaster(quantizeMesh(vertices, indices));
}

test('smoke volumes fill open space and stay out of walls and floors', () => {
	const effect: ReplayEffect = {
		type: 'smoke',
		thrower: 0,
		startTick: 0,
		endTick: 100,
		x: 0,
		y: 0,
		z: 2
	};
	const volume = smokeVolume(effect, room());
	const [nx, ny] = volume.dims;
	assert.ok(volume.cells.length > 900);
	const centers = volume.cells.map((cell) => [
		volume.min[0] + ((cell % nx) + 0.5) * volume.cell,
		volume.min[1] + ((Math.floor(cell / nx) % ny) + 0.5) * volume.cell,
		volume.min[2] + (Math.floor(cell / (nx * ny)) + 0.5) * volume.cell
	]);
	assert.ok(centers.every(([x, , z]) => x! < 50 && z! > 0));
	const first = centers[0]!;
	assert.ok(Math.hypot(first[0]!, first[1]!) < volume.cell);
	const spanY = Math.max(...centers.map((c) => c[1]!)) - Math.min(...centers.map((c) => c[1]!));
	const spanX = Math.max(...centers.map((c) => c[0]!)) - Math.min(...centers.map((c) => c[0]!));
	assert.ok(spanY > spanX);
});
