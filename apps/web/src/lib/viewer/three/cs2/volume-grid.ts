import * as THREE from 'three';

export const GRID_SLOTS = 8;
export const GRID_WIDTH = 2048;
export const GRID_OVERFLOW = 4095;
const GRID_CELL = 160;
const GRID_MAX_CELLS = 65536;

export function buildVolumeGrid(boxes: THREE.Box3[]): {
	data: Float32Array;
	width: number;
	height: number;
	min: THREE.Vector3;
	scale: THREE.Vector3;
	dims: THREE.Vector3;
} {
	const bounds = new THREE.Box3();
	for (const box of boxes) bounds.union(box);
	if (bounds.isEmpty()) bounds.set(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
	const size = bounds.getSize(new THREE.Vector3()).max(new THREE.Vector3(1, 1, 1));
	let cell = GRID_CELL;
	const dimsFor = (c: number) =>
		new THREE.Vector3(
			Math.max(1, Math.ceil(size.x / c)),
			Math.max(1, Math.ceil(size.y / c)),
			Math.max(1, Math.ceil(size.z / c))
		);
	let dims = dimsFor(cell);
	while (dims.x * dims.y * dims.z > GRID_MAX_CELLS) dims = dimsFor((cell *= 1.25));
	const scale = new THREE.Vector3(dims.x / size.x, dims.y / size.y, dims.z / size.z);
	const cells = dims.x * dims.y * dims.z;
	const texels = cells * (GRID_SLOTS / 4);
	const width = Math.min(GRID_WIDTH, texels);
	const height = Math.ceil(texels / GRID_WIDTH);
	const data = new Float32Array(width * height * 4);
	const counts = new Uint8Array(cells);
	const lo = new THREE.Vector3();
	const hi = new THREE.Vector3();
	boxes.forEach((box, index) => {
		lo.copy(box.min).sub(bounds.min).multiply(scale).floor().max(new THREE.Vector3());
		hi.copy(box.max).sub(bounds.min).multiply(scale).floor().min(dims.clone().subScalar(1));
		for (let z = lo.z; z <= hi.z; z++)
			for (let y = lo.y; y <= hi.y; y++)
				for (let x = lo.x; x <= hi.x; x++) {
					const c = x + y * dims.x + z * dims.x * dims.y;
					const n = counts[c]!;
					if (n > GRID_SLOTS) continue;
					if (n === GRID_SLOTS) {
						data[c * GRID_SLOTS] = GRID_OVERFLOW + 1;
						counts[c] = n + 1;
						continue;
					}
					data[c * GRID_SLOTS + n] = index + 1;
					counts[c] = n + 1;
				}
	});
	return { data, width, height, min: bounds.min.clone(), scale, dims };
}
