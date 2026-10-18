import { dequantize, type MapMesh } from '@cs-demo-cloud/replay';

const LEAF_SIZE = 8;

export interface RayHit {
	distance: number;
	normal: [number, number, number];
}

export class MeshRaycaster {
	private vertices: Float32Array;
	private indices: Uint32Array;
	private triangles: Uint32Array;
	private nodeBounds: Float32Array;
	private nodeData: Uint32Array;
	private nodeCount = 0;

	constructor(mesh: MapMesh) {
		const vertexCount = mesh.positions.length / 3;
		this.vertices = new Float32Array(vertexCount * 3);
		for (let i = 0; i < vertexCount; i++) this.vertices.set(dequantize(mesh, i), i * 3);
		const triangleCount = mesh.indices.length / 3;
		this.triangles = new Uint32Array(triangleCount);
		for (let i = 0; i < triangleCount; i++) this.triangles[i] = i;
		this.indices = mesh.indices;

		const centroids = new Float32Array(triangleCount * 3);
		const bounds = new Float32Array(triangleCount * 6);
		for (let t = 0; t < triangleCount; t++) {
			for (let axis = 0; axis < 3; axis++) {
				const a = this.vertices[mesh.indices[t * 3]! * 3 + axis]!;
				const b = this.vertices[mesh.indices[t * 3 + 1]! * 3 + axis]!;
				const c = this.vertices[mesh.indices[t * 3 + 2]! * 3 + axis]!;
				bounds[t * 6 + axis] = Math.min(a, b, c);
				bounds[t * 6 + 3 + axis] = Math.max(a, b, c);
				centroids[t * 3 + axis] = (a + b + c) / 3;
			}
		}

		const maxNodes = Math.max(1, Math.ceil((triangleCount / LEAF_SIZE) * 2) + 1);
		this.nodeBounds = new Float32Array(maxNodes * 6);
		this.nodeData = new Uint32Array(maxNodes * 3);
		this.build(0, triangleCount, bounds, centroids);
	}

	private build(start: number, end: number, bounds: Float32Array, centroids: Float32Array) {
		const stack: [number, number, number][] = [[start, end, this.allocate()]];
		while (stack.length) {
			const [from, to, node] = stack.pop()!;
			const box = this.nodeBounds.subarray(node * 6, node * 6 + 6);
			box.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
			const cMin = [Infinity, Infinity, Infinity];
			const cMax = [-Infinity, -Infinity, -Infinity];
			for (let i = from; i < to; i++) {
				const t = this.triangles[i]!;
				for (let axis = 0; axis < 3; axis++) {
					box[axis] = Math.min(box[axis]!, bounds[t * 6 + axis]!);
					box[axis + 3] = Math.max(box[axis + 3]!, bounds[t * 6 + 3 + axis]!);
					cMin[axis] = Math.min(cMin[axis]!, centroids[t * 3 + axis]!);
					cMax[axis] = Math.max(cMax[axis]!, centroids[t * 3 + axis]!);
				}
			}
			if (to - from <= LEAF_SIZE) {
				this.nodeData.set([1, from, to], node * 3);
				continue;
			}
			let axis = 0;
			for (let a = 1; a < 3; a++) if (cMax[a]! - cMin[a]! > cMax[axis]! - cMin[axis]!) axis = a;
			const split = (cMin[axis]! + cMax[axis]!) / 2;
			let mid = from;
			for (let i = from; i < to; i++) {
				const t = this.triangles[i]!;
				if (centroids[t * 3 + axis]! < split) {
					this.triangles[i] = this.triangles[mid]!;
					this.triangles[mid] = t;
					mid++;
				}
			}
			if (mid === from || mid === to) mid = (from + to) >> 1;
			const left = this.allocate();
			const right = this.allocate();
			this.nodeData.set([0, left, right], node * 3);
			stack.push([from, mid, left], [mid, to, right]);
		}
	}

	private allocate(): number {
		if (this.nodeCount * 6 >= this.nodeBounds.length) {
			const bounds = new Float32Array(this.nodeBounds.length * 2);
			bounds.set(this.nodeBounds);
			this.nodeBounds = bounds;
			const data = new Uint32Array(this.nodeData.length * 2);
			data.set(this.nodeData);
			this.nodeData = data;
		}
		return this.nodeCount++;
	}

	cast(
		origin: [number, number, number],
		direction: [number, number, number],
		maxDistance: number
	): RayHit | null {
		const [ox, oy, oz] = origin;
		const [dx, dy, dz] = direction;
		const ix = 1 / dx;
		const iy = 1 / dy;
		const iz = 1 / dz;
		let best = maxDistance;
		let bestTriangle = -1;
		const stack = [0];
		const v = this.vertices;
		while (stack.length) {
			const node = stack.pop()!;
			const b = node * 6;
			let t0 = 0;
			let t1 = best;
			const near = (min: number, max: number, o: number, inv: number) => {
				let a = (min - o) * inv;
				let c = (max - o) * inv;
				if (a > c) [a, c] = [c, a];
				if (a > t0) t0 = a;
				if (c < t1) t1 = c;
			};
			near(this.nodeBounds[b]!, this.nodeBounds[b + 3]!, ox, ix);
			near(this.nodeBounds[b + 1]!, this.nodeBounds[b + 4]!, oy, iy);
			near(this.nodeBounds[b + 2]!, this.nodeBounds[b + 5]!, oz, iz);
			if (t0 > t1) continue;
			const d = node * 3;
			if (this.nodeData[d] === 0) {
				stack.push(this.nodeData[d + 1]!, this.nodeData[d + 2]!);
				continue;
			}
			for (let i = this.nodeData[d + 1]!; i < this.nodeData[d + 2]!; i++) {
				const t = this.triangles[i]!;
				const a = this.indices[t * 3]! * 3;
				const e1x = v[this.indices[t * 3 + 1]! * 3]! - v[a]!;
				const e1y = v[this.indices[t * 3 + 1]! * 3 + 1]! - v[a + 1]!;
				const e1z = v[this.indices[t * 3 + 1]! * 3 + 2]! - v[a + 2]!;
				const e2x = v[this.indices[t * 3 + 2]! * 3]! - v[a]!;
				const e2y = v[this.indices[t * 3 + 2]! * 3 + 1]! - v[a + 1]!;
				const e2z = v[this.indices[t * 3 + 2]! * 3 + 2]! - v[a + 2]!;
				const px = dy * e2z - dz * e2y;
				const py = dz * e2x - dx * e2z;
				const pz = dx * e2y - dy * e2x;
				const det = e1x * px + e1y * py + e1z * pz;
				if (Math.abs(det) < 1e-9) continue;
				const inv = 1 / det;
				const sx = ox - v[a]!;
				const sy = oy - v[a + 1]!;
				const sz = oz - v[a + 2]!;
				const u = (sx * px + sy * py + sz * pz) * inv;
				if (u < 0 || u > 1) continue;
				const qx = sy * e1z - sz * e1y;
				const qy = sz * e1x - sx * e1z;
				const qz = sx * e1y - sy * e1x;
				const w = (dx * qx + dy * qy + dz * qz) * inv;
				if (w < 0 || u + w > 1) continue;
				const distance = (e2x * qx + e2y * qy + e2z * qz) * inv;
				if (distance > 1e-3 && distance < best) {
					best = distance;
					bestTriangle = t;
				}
			}
		}
		if (bestTriangle < 0) return null;
		return { distance: best, normal: this.normalOf(bestTriangle, direction) };
	}

	private normalOf(t: number, direction: [number, number, number]): [number, number, number] {
		const v = this.vertices;
		const a = this.indices[t * 3]! * 3;
		const b = this.indices[t * 3 + 1]! * 3;
		const c = this.indices[t * 3 + 2]! * 3;
		const e1 = [v[b]! - v[a]!, v[b + 1]! - v[a + 1]!, v[b + 2]! - v[a + 2]!];
		const e2 = [v[c]! - v[a]!, v[c + 1]! - v[a + 1]!, v[c + 2]! - v[a + 2]!];
		let n: [number, number, number] = [
			e1[1]! * e2[2]! - e1[2]! * e2[1]!,
			e1[2]! * e2[0]! - e1[0]! * e2[2]!,
			e1[0]! * e2[1]! - e1[1]! * e2[0]!
		];
		const length = Math.hypot(...n) || 1;
		n = [n[0] / length, n[1] / length, n[2] / length];
		if (n[0] * direction[0] + n[1] * direction[1] + n[2] * direction[2] > 0)
			n = [-n[0], -n[1], -n[2]];
		return n;
	}
}
