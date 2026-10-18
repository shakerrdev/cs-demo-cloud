import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quantizeMesh } from '@cs-demo-cloud/replay';
import { bulletDirections } from './impacts.ts';
import { MeshRaycaster } from './raycast.ts';

function wall(x: number): MeshRaycaster {
	const vertices = new Float32Array([
		x,
		-100,
		-100,
		x,
		100,
		-100,
		x,
		100,
		100,
		x,
		-100,
		100,
		-500,
		-500,
		-500,
		500,
		500,
		500
	]);
	return new MeshRaycaster(quantizeMesh(vertices, new Uint32Array([0, 1, 2, 0, 2, 3])));
}

test('a ray hits the wall in front with a normal facing back', () => {
	const hit = wall(200).cast([0, 0, 0], [1, 0, 0], 8192);
	assert.ok(hit);
	assert.ok(Math.abs(hit.distance - 200) < 0.1);
	assert.deepEqual(
		hit.normal.map((v) => Math.round(v) + 0),
		[-1, 0, 0]
	);
});

test('a ray that misses the wall or points away finds nothing', () => {
	assert.equal(wall(200).cast([0, 0, 0], [-1, 0, 0], 8192), null);
	assert.equal(wall(200).cast([0, 300, 0], [1, 0, 0], 8192), null);
	assert.equal(wall(200).cast([0, 0, 0], [1, 0, 0], 100), null);
});

test('bullets without spread fly along the view angles', () => {
	const [down] = bulletDirections(90, 0, 0, 0, 1, 1);
	assert.ok(Math.abs(down![2] + 1) < 1e-6);
	const [left] = bulletDirections(0, 90, 0, 0, 1, 1);
	assert.ok(Math.abs(left![1] - 1) < 1e-6);
});

test('spread is deterministic per seed and stays inside the cone', () => {
	const a = bulletDirections(0, 0, 0.05, 0.01, 1234, 6);
	assert.deepEqual(a, bulletDirections(0, 0, 0.05, 0.01, 1234, 6));
	assert.equal(a.length, 6);
	for (const d of a) assert.ok(Math.hypot(d[1], d[2]) / d[0] <= 0.0601);
	assert.notDeepEqual(a[0], bulletDirections(0, 0, 0.05, 0.01, 99, 1)[0]);
});
