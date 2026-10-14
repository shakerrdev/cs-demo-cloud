const AWPY_MAGIC = 0x484d5741;
const MESH_MAGIC = 0x484d5343;
export const MAP_MESH_VERSION = 1;
const HEADER_SIZE = 40;
const AXES = [0, 1, 2] as const;

export type Vec3 = [number, number, number];

export interface MapMesh {
	positions: Uint16Array;
	indices: Uint32Array;
	min: Vec3;
	max: Vec3;
}

export function readAwpyMesh(input: Uint8Array): { vertices: Float32Array; indices: Uint32Array } {
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	if (input.byteLength < 16 || view.getUint32(0, true) !== AWPY_MAGIC)
		throw new Error('Not an awpy mesh');
	if (view.getUint32(4, true) !== 1) throw new Error('Unsupported awpy mesh version');

	const vertexCount = view.getUint32(8, true);
	const triangleCount = view.getUint32(12, true);
	const expected = 16 + vertexCount * 12 + triangleCount * 12;
	if (input.byteLength !== expected)
		throw new Error(`awpy mesh is ${input.byteLength} bytes, expected ${expected}`);

	const vertices = new Float32Array(vertexCount * 3);
	for (let i = 0; i < vertices.length; i++) vertices[i] = view.getFloat32(16 + i * 4, true);
	const indices = new Uint32Array(triangleCount * 3);
	const indexStart = 16 + vertexCount * 12;
	for (let i = 0; i < indices.length; i++) {
		const index = view.getUint32(indexStart + i * 4, true);
		if (index >= vertexCount) throw new Error('awpy mesh has an index out of range');
		indices[i] = index;
	}
	return { vertices, indices };
}

export function quantizeMesh(vertices: Float32Array, indices: Uint32Array): MapMesh {
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < vertices.length; i += 3) {
		for (const axis of AXES) {
			min[axis] = Math.min(min[axis], vertices[i + axis]!);
			max[axis] = Math.max(max[axis], vertices[i + axis]!);
		}
	}
	for (const axis of AXES) {
		min[axis] = vertices.length ? Math.fround(min[axis]) : 0;
		max[axis] = vertices.length ? Math.fround(max[axis]) : 0;
	}

	const positions = new Uint16Array(vertices.length);
	for (let i = 0; i < vertices.length; i += 3) {
		for (const axis of AXES) {
			const extent = max[axis] - min[axis];
			const t = extent > 0 ? (vertices[i + axis]! - min[axis]) / extent : 0;
			positions[i + axis] = Math.round(Math.min(1, Math.max(0, t)) * 65535);
		}
	}
	return { positions, indices, min, max };
}

export function dequantize(mesh: MapMesh, index: number): Vec3 {
	const out: Vec3 = [0, 0, 0];
	for (const axis of AXES) {
		const t = mesh.positions[index * 3 + axis]! / 65535;
		out[axis] = mesh.min[axis] + (mesh.max[axis] - mesh.min[axis]) * t;
	}
	return out;
}

export function encodeMapMesh(mesh: MapMesh): Uint8Array {
	const vertexCount = mesh.positions.length / 3;
	const triangleCount = mesh.indices.length / 3;

	const positions = new Uint16Array(mesh.positions.length);
	for (let axis = 0; axis < 3; axis++) {
		let previous = 0;
		for (let i = 0; i < vertexCount; i++) {
			const value = mesh.positions[i * 3 + axis]!;
			const delta = ((value - previous + 32768) & 0xffff) - 32768;
			positions[axis * vertexCount + i] = ((delta << 1) ^ (delta >> 15)) & 0xffff;
			previous = value;
		}
	}

	const indices = new Uint32Array(mesh.indices.length);
	let previous = 0;
	for (let i = 0; i < indices.length; i++) {
		const value = mesh.indices[i]!;
		const delta = value - previous;
		indices[i] = ((delta << 1) ^ (delta >> 31)) >>> 0;
		previous = value;
	}

	const out = new Uint8Array(HEADER_SIZE + positions.byteLength + indices.byteLength);
	const view = new DataView(out.buffer);
	view.setUint32(0, MESH_MAGIC, true);
	view.setUint32(4, MAP_MESH_VERSION, true);
	view.setUint32(8, vertexCount, true);
	view.setUint32(12, triangleCount, true);
	for (const axis of AXES) {
		view.setFloat32(16 + axis * 4, mesh.min[axis], true);
		view.setFloat32(28 + axis * 4, mesh.max[axis], true);
	}
	splitBytes(new Uint8Array(positions.buffer), 2, out, HEADER_SIZE);
	splitBytes(new Uint8Array(indices.buffer), 4, out, HEADER_SIZE + positions.byteLength);
	return out;
}

export function decodeMapMesh(input: ArrayBuffer | Uint8Array): MapMesh {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.byteLength < HEADER_SIZE || view.getUint32(0, true) !== MESH_MAGIC)
		throw new Error('Not a map mesh');
	if (view.getUint32(4, true) !== MAP_MESH_VERSION) throw new Error('Unsupported map mesh version');

	const vertexCount = view.getUint32(8, true);
	const triangleCount = view.getUint32(12, true);
	const positionBytes = vertexCount * 6;
	const indexBytes = triangleCount * 12;
	if (bytes.byteLength !== HEADER_SIZE + positionBytes + indexBytes)
		throw new Error('Map mesh has the wrong size');

	const min: Vec3 = [0, 0, 0];
	const max: Vec3 = [0, 0, 0];
	for (const axis of AXES) {
		min[axis] = view.getFloat32(16 + axis * 4, true);
		max[axis] = view.getFloat32(28 + axis * 4, true);
	}

	const columns = new Uint16Array(vertexCount * 3);
	joinBytes(bytes, HEADER_SIZE, 2, new Uint8Array(columns.buffer));
	const positions = new Uint16Array(vertexCount * 3);
	for (let axis = 0; axis < 3; axis++) {
		let value = 0;
		for (let i = 0; i < vertexCount; i++) {
			const zigzag = columns[axis * vertexCount + i]!;
			value = (value + ((zigzag >>> 1) ^ -(zigzag & 1))) & 0xffff;
			positions[i * 3 + axis] = value;
		}
	}

	const indices = new Uint32Array(triangleCount * 3);
	joinBytes(bytes, HEADER_SIZE + positionBytes, 4, new Uint8Array(indices.buffer));
	let value = 0;
	for (let i = 0; i < indices.length; i++) {
		const zigzag = indices[i]!;
		value = (value + ((zigzag >>> 1) ^ -(zigzag & 1))) >>> 0;
		if (value >= vertexCount) throw new Error('Map mesh has an index out of range');
		indices[i] = value;
	}

	return { positions, indices, min, max };
}

function splitBytes(source: Uint8Array, width: number, target: Uint8Array, offset: number) {
	const count = source.length / width;
	for (let plane = 0; plane < width; plane++) {
		const start = offset + plane * count;
		for (let i = 0; i < count; i++) target[start + i] = source[i * width + plane]!;
	}
}

function joinBytes(source: Uint8Array, offset: number, width: number, target: Uint8Array) {
	const count = target.length / width;
	for (let plane = 0; plane < width; plane++) {
		const start = offset + plane * count;
		for (let i = 0; i < count; i++) target[i * width + plane] = source[start + i]!;
	}
}
