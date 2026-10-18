import * as THREE from 'three';
import {
	IMPACT_BLOOD,
	IMPACT_FLESH,
	IMPACT_MISS,
	IMPACT_STRIDE,
	IMPACT_WALL,
	type RoundReplay
} from '@cs-demo-cloud/replay';

const MAX_DECALS = 768;
const MAX_PUFFS = 48;
const PUFF_SECONDS = 0.6;
const HOLE_SIZE = 3.2;
const BLOOD_SIZE = 34;

const decalVertex = /* glsl */ `
in float aKind;
in float aSeed;
out vec2 vUv;
flat out float vKind;
flat out float vSeed;
void main() {
	vUv = uv;
	vKind = aKind;
	vSeed = aSeed;
	gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const decalFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
flat in float vKind;
flat in float vSeed;
uniform float uCutZ;
out vec4 outColor;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length(p);
	float angle = atan(p.y, p.x);
	vec3 color = vec3(1.0);
	if (vKind < 0.5) {
		float edge = 0.55 + 0.25 * noise(vec2(angle * 2.5, vSeed * 7.0));
		float chip = smoothstep(edge + 0.35, edge, r) * 0.45;
		float core = smoothstep(0.32, 0.18, r + 0.05 * noise(p * 6.0 + vSeed));
		color = vec3(1.0 - chip) * mix(vec3(1.0), vec3(0.06), core);
	} else {
		float mask = 0.0;
		for (int i = 0; i < 7; i++) {
			float fi = float(i);
			vec2 c = vec2(hash(vec2(vSeed, fi)), hash(vec2(fi, vSeed))) * 1.1 - 0.55;
			float size = 0.12 + 0.22 * hash(vec2(vSeed + fi, 3.1));
			mask = max(mask, smoothstep(size, size * 0.55, length(p - c * (0.4 + 0.6 * fi / 6.0))));
		}
		float streak = smoothstep(0.08, 0.0, abs(p.y + 0.15 * sin(p.x * 3.0 + vSeed))) * smoothstep(1.0, 0.2, abs(p.x));
		mask = max(mask, streak * step(0.5, hash(vec2(vSeed, 9.0))));
		mask *= 0.55 + 0.45 * noise(p * 9.0 + vSeed);
		mask *= smoothstep(1.0, 0.7, r);
		color = mix(vec3(1.0), vec3(0.32, 0.03, 0.03), clamp(mask * 1.3, 0.0, 1.0));
	}
	outColor = vec4(color, 1.0);
}
`;

const puffVertex = /* glsl */ `
out vec2 vUv;
void main() {
	vUv = uv;
	vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
	vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
	gl_Position = projectionMatrix * (center + vec4(position.xy * scale, 0.0, 0.0));
}
`;

const puffFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform float uAge;
uniform float uFlesh;
uniform float uSeed;
uniform vec3 uLight;
out vec4 outColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float t = clamp(uAge, 0.0, 1.0);
	float n = noise(p * 3.5 + uSeed + t * 2.0) * 0.6 + noise(p * 8.0 - uSeed) * 0.4;
	float shape = smoothstep(1.0, 0.25, length(p) + (n - 0.5) * 0.6);
	float alpha = shape * (1.0 - t) * (1.0 - t) * mix(0.75, 0.9, uFlesh);
	vec3 dust = uLight * vec3(0.78, 0.72, 0.62);
	vec3 blood = uLight * vec3(0.35, 0.02, 0.02);
	vec3 color = mix(dust, blood, uFlesh);
	float spark = (1.0 - uFlesh) * smoothstep(0.15, 0.0, t) * smoothstep(0.35, 0.0, length(p));
	outColor = vec4(color * alpha + vec3(6.0, 3.5, 1.2) * spark, alpha);
}
`;

interface Puff {
	mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
}

export interface ImpactPoint {
	tick: number;
	player: number;
	position: THREE.Vector3;
	kind: number;
}

export class ImpactEffects {
	readonly root = new THREE.Group();
	private decals: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private plane = new THREE.PlaneGeometry(1, 1);
	private puffs: Puff[] = [];
	private impacts: ImpactPoint[] = [];
	private decalTicks: number[] = [];
	private round = -1;
	private light = new THREE.Vector3(1, 1, 1);

	constructor() {
		const geometry = new THREE.PlaneGeometry(1, 1);
		geometry.setAttribute(
			'aKind',
			new THREE.InstancedBufferAttribute(new Float32Array(MAX_DECALS), 1)
		);
		geometry.setAttribute(
			'aSeed',
			new THREE.InstancedBufferAttribute(new Float32Array(MAX_DECALS), 1)
		);
		this.decals = new THREE.InstancedMesh(
			geometry,
			new THREE.ShaderMaterial({
				glslVersion: THREE.GLSL3,
				vertexShader: decalVertex,
				fragmentShader: decalFragment,
				uniforms: { uCutZ: { value: 1e9 } },
				transparent: true,
				depthWrite: false,
				blending: THREE.MultiplyBlending,
				premultipliedAlpha: true,
				polygonOffset: true,
				polygonOffsetFactor: -4,
				polygonOffsetUnits: -4
			}),
			MAX_DECALS
		);
		this.decals.count = 0;
		this.decals.frustumCulled = false;
		this.decals.renderOrder = 2;
		this.root.add(this.decals);
	}

	setLight(light: THREE.Vector3) {
		this.light.copy(light);
	}

	impactFor(tick: number, player: number, skip: number): ImpactPoint | null {
		let seen = 0;
		for (const impact of this.impacts) {
			if (impact.tick > tick) break;
			if (impact.tick !== tick || impact.player !== player) continue;
			if (seen++ === skip) return impact;
		}
		return null;
	}

	update(replay: RoundReplay, tick: number) {
		if (replay.meta.round !== this.round) this.load(replay);
		const rate = replay.meta.tickRate;
		let count = 0;
		while (count < this.decalTicks.length && this.decalTicks[count]! <= tick) count++;
		this.decals.count = count;

		let puffs = 0;
		for (const impact of this.impacts) {
			if (impact.tick > tick) break;
			const age = (tick - impact.tick) / rate / PUFF_SECONDS;
			if (age >= 1 || impact.kind === IMPACT_MISS || impact.kind === IMPACT_BLOOD) continue;
			if (puffs >= MAX_PUFFS) break;
			const puff = this.puff(puffs++);
			const flesh = impact.kind === IMPACT_FLESH;
			const u = puff.mesh.material.uniforms;
			u.uAge!.value = age;
			u.uFlesh!.value = flesh ? 1 : 0;
			u.uSeed!.value = (impact.tick % 97) * 0.37;
			puff.mesh.position.copy(impact.position);
			puff.mesh.scale.setScalar((flesh ? 14 : 10) + age * (flesh ? 26 : 34));
		}
		for (let i = puffs; i < this.puffs.length; i++) this.puffs[i]!.mesh.visible = false;
	}

	private load(replay: RoundReplay) {
		this.round = replay.meta.round;
		this.impacts = [];
		this.decalTicks = [];
		const data = replay.meta.impacts ?? [];
		const kinds = this.decals.geometry.getAttribute('aKind') as THREE.InstancedBufferAttribute;
		const seeds = this.decals.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute;
		const matrix = new THREE.Matrix4();
		const quaternion = new THREE.Quaternion();
		const roll = new THREE.Quaternion();
		const normal = new THREE.Vector3();
		const forward = new THREE.Vector3(0, 0, 1);
		const position = new THREE.Vector3();
		const scale = new THREE.Vector3();
		for (let i = 0; i + IMPACT_STRIDE - 1 < data.length; i += IMPACT_STRIDE) {
			const kind = data[i + 8]!;
			const point: ImpactPoint = {
				tick: data[i]!,
				player: data[i + 1]!,
				position: new THREE.Vector3(data[i + 2], data[i + 3], data[i + 4]),
				kind
			};
			this.impacts.push(point);
			if (kind !== IMPACT_WALL && kind !== IMPACT_BLOOD) continue;
			const slot = this.decalTicks.length;
			if (slot >= MAX_DECALS) continue;
			normal.set(data[i + 5]!, data[i + 6]!, data[i + 7]!).normalize();
			const seed = ((data[i]! * 31 + i * 7) % 1000) / 1000;
			quaternion.setFromUnitVectors(forward, normal);
			roll.setFromAxisAngle(forward, seed * Math.PI * 2);
			quaternion.multiply(roll);
			const size = kind === IMPACT_BLOOD ? BLOOD_SIZE * (0.7 + 0.6 * seed) : HOLE_SIZE;
			position.copy(point.position).addScaledVector(normal, 0.2);
			matrix.compose(position, quaternion, scale.set(size, size, 1));
			this.decals.setMatrixAt(slot, matrix);
			kinds.setX(slot, kind === IMPACT_BLOOD ? 1 : 0);
			seeds.setX(slot, seed * 13.7);
			this.decalTicks.push(point.tick);
		}
		this.decals.instanceMatrix.needsUpdate = true;
		kinds.needsUpdate = true;
		seeds.needsUpdate = true;
	}

	private puff(index: number): Puff {
		let puff = this.puffs[index];
		if (!puff) {
			const mesh = new THREE.Mesh(
				this.plane,
				new THREE.ShaderMaterial({
					glslVersion: THREE.GLSL3,
					vertexShader: puffVertex,
					fragmentShader: puffFragment,
					uniforms: {
						uAge: { value: 0 },
						uFlesh: { value: 0 },
						uSeed: { value: 0 },
						uLight: { value: this.light }
					},
					transparent: true,
					depthWrite: false,
					blending: THREE.CustomBlending,
					blendSrc: THREE.OneFactor,
					blendDst: THREE.OneMinusSrcAlphaFactor
				})
			);
			mesh.frustumCulled = false;
			mesh.renderOrder = 7;
			this.root.add(mesh);
			puff = { mesh };
			this.puffs.push(puff);
		}
		puff.mesh.visible = true;
		return puff;
	}

	dispose() {
		this.decals.geometry.dispose();
		this.decals.material.dispose();
		this.decals.dispose();
		for (const puff of this.puffs) puff.mesh.material.dispose();
		this.plane.dispose();
	}
}
