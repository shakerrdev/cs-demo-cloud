import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildVolumeGrid, GRID_OVERFLOW, GRID_SLOTS } from './volume-grid.ts';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
	new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));

function slotsAt(grid: ReturnType<typeof buildVolumeGrid>, x: number, y: number, z: number) {
	const c = new THREE.Vector3(x, y, z).sub(grid.min).multiply(grid.scale).floor();
	const cell = c.x + c.y * grid.dims.x + c.z * grid.dims.x * grid.dims.y;
	return [...grid.data.subarray(cell * GRID_SLOTS, cell * GRID_SLOTS + GRID_SLOTS)];
}

test('lists the volumes overlapping each cell in order', () => {
	const grid = buildVolumeGrid([box(0, 0, 0, 1000, 1000, 200), box(800, 800, 0, 1600, 1600, 200)]);
	assert.deepEqual(slotsAt(grid, 100, 100, 50).slice(0, 2), [1, 0]);
	assert.deepEqual(slotsAt(grid, 900, 900, 50).slice(0, 3), [1, 2, 0]);
	assert.deepEqual(slotsAt(grid, 1500, 1500, 50).slice(0, 2), [2, 0]);
});

test('marks crowded cells so the shader falls back to every volume', () => {
	const boxes = Array.from({ length: GRID_SLOTS + 2 }, () => box(0, 0, 0, 100, 100, 100));
	const grid = buildVolumeGrid(boxes);
	assert.equal(slotsAt(grid, 50, 50, 50)[0], GRID_OVERFLOW + 1);
});
