import * as THREE from 'three';
import type { RoundReplay } from '@cs-demo-cloud/replay';

const MAX_SEGMENTS = 512;
const FADE_START = 0.8;
const FADE_END = 2.4;

const vertex = /* glsl */ `
in vec3 aOther;
in float aSide;
in float aAlpha;
out float vAlpha;
out float vSide;
void main() {
	vec4 view = viewMatrix * vec4(position, 1.0);
	vec4 other = viewMatrix * vec4(aOther, 1.0);
	vec3 along = normalize(other.xyz - view.xyz + vec3(1e-5));
	vec3 across = normalize(cross(along, normalize(view.xyz)));
	float width = max(0.6, -view.z * 0.0024);
	view.xyz += across * aSide * width;
	vAlpha = aAlpha;
	vSide = aSide;
	gl_Position = projectionMatrix * view;
}
`;

const fragment = /* glsl */ `
precision highp float;
in float vAlpha;
in float vSide;
out vec4 outColor;
void main() {
	float core = exp(-vSide * vSide * 4.0);
	outColor = vec4(vec3(3.2, 2.6, 1.1) * core * vAlpha, 1.0);
}
`;

export class GrenadeTrails {
	readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
	private position = new Float32Array(MAX_SEGMENTS * 6 * 3);
	private other = new Float32Array(MAX_SEGMENTS * 6 * 3);
	private side = new Float32Array(MAX_SEGMENTS * 6);
	private alpha = new Float32Array(MAX_SEGMENTS * 6);
	private count = 0;

	constructor() {
		const geometry = new THREE.BufferGeometry();
		const attribute = (array: Float32Array, size: number) =>
			new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
		geometry.setAttribute('position', attribute(this.position, 3));
		geometry.setAttribute('aOther', attribute(this.other, 3));
		geometry.setAttribute('aSide', attribute(this.side, 1));
		geometry.setAttribute('aAlpha', attribute(this.alpha, 1));
		this.mesh = new THREE.Mesh(
			geometry,
			new THREE.ShaderMaterial({
				glslVersion: THREE.GLSL3,
				vertexShader: vertex,
				fragmentShader: fragment,
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide
			})
		);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 3;
	}

	update(replay: RoundReplay, tick: number) {
		const rate = replay.meta.tickRate;
		this.count = 0;
		for (const grenade of replay.meta.grenades) {
			const path = grenade.path;
			const points = path.length / 4;
			if (points < 2 || tick < path[0]!) continue;
			const landed = path[(points - 1) * 4]!;
			if (tick > landed + FADE_END * rate) continue;
			const fade = (t: number) => {
				const age = (tick - t) / rate;
				const x = Math.min(1, Math.max(0, (age - FADE_START) / (FADE_END - FADE_START)));
				return 1 - x * x * (3 - 2 * x);
			};
			for (let i = 0; i < points - 1; i++) {
				const t0 = path[i * 4]!;
				let t1 = path[(i + 1) * 4]!;
				if (t0 > tick) break;
				let k = 1;
				if (t1 > tick) {
					k = t1 === t0 ? 0 : (tick - t0) / (t1 - t0);
					t1 = tick;
				}
				const a = i * 4 + 1;
				const b = a + 4;
				this.segment(
					path[a]!,
					path[a + 1]!,
					path[a + 2]!,
					path[a]! + (path[b]! - path[a]!) * k,
					path[a + 1]! + (path[b + 1]! - path[a + 1]!) * k,
					path[a + 2]! + (path[b + 2]! - path[a + 2]!) * k,
					fade(t0),
					fade(t1)
				);
			}
		}
		const geometry = this.mesh.geometry;
		geometry.setDrawRange(0, this.count * 6);
		for (const name of ['position', 'aOther', 'aSide', 'aAlpha'])
			(geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
		this.mesh.visible = this.count > 0;
	}

	private segment(
		ax: number,
		ay: number,
		az: number,
		bx: number,
		by: number,
		bz: number,
		alphaA: number,
		alphaB: number
	) {
		if (this.count >= MAX_SEGMENTS || (alphaA <= 0 && alphaB <= 0)) return;
		const base = this.count * 6;
		const corners: [boolean, number][] = [
			[false, -1],
			[false, 1],
			[true, 1],
			[false, -1],
			[true, 1],
			[true, -1]
		];
		corners.forEach(([end, side], j) => {
			const v = base + j;
			const [px, py, pz, ox, oy, oz] = end
				? [bx, by, bz, bx * 2 - ax, by * 2 - ay, bz * 2 - az]
				: [ax, ay, az, bx, by, bz];
			this.position.set([px, py, pz], v * 3);
			this.other.set([ox, oy, oz], v * 3);
			this.side[v] = side;
			this.alpha[v] = end ? alphaB : alphaA;
		});
		this.count++;
	}

	dispose() {
		this.mesh.geometry.dispose();
		this.mesh.material.dispose();
	}
}
