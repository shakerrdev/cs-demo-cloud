import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeMapMesh, dequantize, encodeMapMesh, quantizeMesh, readAwpyMesh } from './mesh.ts';

function awpyMesh(vertices: number[], indices: number[]): Uint8Array {
	const out = new Uint8Array(16 + vertices.length * 4 + indices.length * 4);
	const view = new DataView(out.buffer);
	out.set(new TextEncoder().encode('AWMH'), 0);
	view.setUint32(4, 1, true);
	view.setUint32(8, vertices.length / 3, true);
	view.setUint32(12, indices.length / 3, true);
	vertices.forEach((value, i) => view.setFloat32(16 + i * 4, value, true));
	indices.forEach((value, i) => view.setUint32(16 + vertices.length * 4 + i * 4, value, true));
	return out;
}

test('reads the awpy mesh layout', () => {
	const mesh = readAwpyMesh(awpyMesh([0, 0, 0, 64, 0, 0, 0, 64, 8], [0, 1, 2]));

	assert.deepEqual(Array.from(mesh.vertices), [0, 0, 0, 64, 0, 0, 0, 64, 8]);
	assert.deepEqual(Array.from(mesh.indices), [0, 1, 2]);
});

test('rejects broken awpy meshes', () => {
	assert.throws(() => readAwpyMesh(new Uint8Array(16)), /Not an awpy mesh/);
	assert.throws(() => readAwpyMesh(awpyMesh([0, 0, 0], [0, 0, 1])), /out of range/);
	assert.throws(() => readAwpyMesh(awpyMesh([0, 0, 0], [0, 0, 0]).subarray(0, 20)), /bytes/);
});

test('quantizes within a fraction of a unit', () => {
	const vertices = Float32Array.from([-4096, -3864.5, -448, 1824, 2048, 771.15, 12.3, -7.7, 0]);
	const mesh = quantizeMesh(vertices, Uint32Array.from([0, 1, 2]));

	for (let i = 0; i < 3; i++) {
		const point = dequantize(mesh, i);
		point.forEach((value, axis) => {
			assert.ok(Math.abs(value - vertices[i * 3 + axis]!) < 0.1, `vertex ${i} axis ${axis}`);
		});
	}
});

test('round trip keeps positions and indices', () => {
	const count = 5000;
	const vertices = new Float32Array(count * 3);
	for (let i = 0; i < vertices.length; i++) vertices[i] = Math.sin(i * 12.9898) * 4000;
	const indices = new Uint32Array(9000);
	for (let i = 0; i < indices.length; i++) indices[i] = (i * 7919) % count;
	const mesh = quantizeMesh(vertices, indices);

	const decoded = decodeMapMesh(encodeMapMesh(mesh));

	assert.deepEqual(decoded.min, mesh.min);
	assert.deepEqual(decoded.max, mesh.max);
	assert.deepEqual(decoded.positions, mesh.positions);
	assert.deepEqual(decoded.indices, mesh.indices);
});

test('handles big jumps between neighbouring values', () => {
	const mesh = {
		positions: Uint16Array.from([0, 65535, 0, 65535, 0, 65535, 1, 1, 1]),
		indices: Uint32Array.from([2, 0, 1, 0, 2, 1]),
		min: [0, 0, 0] as [number, number, number],
		max: [1, 1, 1] as [number, number, number]
	};

	const decoded = decodeMapMesh(encodeMapMesh(mesh).slice());

	assert.deepEqual(decoded.positions, mesh.positions);
	assert.deepEqual(decoded.indices, mesh.indices);
});

test('rejects data that is not a map mesh', () => {
	assert.throws(() => decodeMapMesh(new Uint8Array(64)), /Not a map mesh/);
});
