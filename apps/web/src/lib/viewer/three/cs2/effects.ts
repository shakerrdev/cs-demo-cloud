import * as THREE from 'three';
import type { ReplayEffect, RoundReplay } from '@cs-demo-cloud/replay';
import type { PlayerState } from '../../frame.ts';
import type { WorldShading } from './material.ts';

const SMOKE_RADIUS = 150;
const SMOKE_HEIGHT = 140;
const SMOKE_BLOOM = 1.2;
const SMOKE_FADE = 2.5;
const SMOKE_TINT = new THREE.Vector3(0.93, 0.95, 1);
const FIRE_RADIUS = 125;
const FIRE_FLAMES = 28;
const FIRE_GROW = 1.4;
const TRACER_SPEED = 7000;
const TRACER_LENGTH = 260;
const TRACER_RANGE = 3000;
const MUZZLE_TICKS = 2;
const DEG = Math.PI / 180;

const noise = /* glsl */ `
float hash3(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
		f.z
	);
}
float fbm(vec3 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		v += a * noise3(p);
		p = p * 2.03 + vec3(1.7, 9.2, 3.1);
		a *= 0.5;
	}
	return v;
}
`;

const smokeVertex = /* glsl */ `
out vec3 vWorld;
void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	vWorld = world.xyz;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const smokeFragment = /* glsl */ `
precision highp float;
in vec3 vWorld;
uniform vec3 uCamera;
uniform vec3 uCenter;
uniform vec3 uRadii;
uniform float uGrowth;
uniform float uFade;
uniform float uSeed;
uniform float uTime;
uniform vec3 uLight;
uniform vec3 uShadow;
out vec4 outColor;
${noise}
vec2 boxHit(vec3 ro, vec3 rd) {
	vec3 inv = 1.0 / rd;
	vec3 t0 = (-vec3(1.0) - ro) * inv;
	vec3 t1 = (vec3(1.0) - ro) * inv;
	vec3 lo = min(t0, t1);
	vec3 hi = max(t0, t1);
	return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}
float density(vec3 q) {
	vec3 p = q * uRadii;
	vec3 drift = vec3(uSeed, uSeed * 1.7, uTime * 0.05);
	float shape = length(q * vec3(1.0, 1.0, 0.95) - vec3(0.0, 0.0, -0.12));
	float lumps = fbm(p * 0.011 + drift);
	float edge = uGrowth * (0.55 + 0.45 * lumps) - shape;
	float body = smoothstep(0.0, 0.1, edge);
	float detail = fbm(p * 0.032 - drift * 2.3);
	float floorCut = smoothstep(-0.92, -0.8, q.z);
	return body * floorCut * clamp(0.15 + 1.25 * detail * detail + 0.4 * body, 0.0, 1.6);
}
void main() {
	vec3 rdWorld = normalize(vWorld - uCamera);
	vec3 ro = (uCamera - uCenter) / uRadii;
	vec3 rd = rdWorld / uRadii;
	float scale = length(rd);
	rd /= scale;
	vec2 hit = boxHit(ro, rd);
	float t = max(hit.x, 0.0);
	float tEnd = hit.y;
	if (tEnd <= t) discard;
	const int STEPS = 36;
	float stepLength = (tEnd - t) / float(STEPS);
	float jitter = hash3(vec3(gl_FragCoord.xy, uTime));
	t += stepLength * jitter;
	float transmittance = 1.0;
	vec3 light = vec3(0.0);
	float worldStep = stepLength / scale;
	for (int i = 0; i < STEPS; i++) {
		vec3 q = ro + rd * t;
		float d = density(q) * uFade;
		if (d > 0.001) {
			float extinction = d * 0.022 * worldStep;
			float absorbed = transmittance * (1.0 - exp(-extinction));
			float height = clamp(q.z * 0.5 + 0.5, 0.0, 1.0);
			float lit = clamp(pow(height, 0.7) * (1.15 - 0.45 * d), 0.0, 1.0);
			light += absorbed * mix(uShadow, uLight, lit);
			transmittance *= exp(-extinction);
			if (transmittance < 0.02) break;
		}
		t += stepLength;
	}
	outColor = vec4(light, 1.0 - transmittance);
}
`;

const flameVertex = /* glsl */ `
in float aSeed;
out vec2 vUv;
out float vSeed;
void main() {
	vUv = uv;
	vSeed = aSeed;
	gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const flameFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
in float vSeed;
uniform float uTime;
uniform float uIntensity;
out vec4 outColor;
${noise}
void main() {
	vec2 uv = vUv;
	float n = fbm(vec3(uv.x * 3.0 + vSeed * 7.0, uv.y * 2.5 - uTime * 2.2, vSeed * 3.0 + uTime * 0.6));
	float width = (1.0 - uv.y) * 0.5 + 0.08;
	float body = 1.0 - smoothstep(width * 0.5, width, abs(uv.x - 0.5) + (n - 0.5) * 0.35 * uv.y);
	float top = 1.0 - smoothstep(0.35, 1.0, uv.y + (n - 0.5) * 0.5);
	float shape = body * top * smoothstep(0.0, 0.08, uv.y);
	if (shape < 0.01) discard;
	float heat = clamp(shape * (1.2 - uv.y) + 0.1, 0.0, 1.0);
	vec3 color = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.7, 0.28), heat) * (1.2 + 4.0 * heat * heat);
	outColor = vec4(color * shape * uIntensity, 1.0);
}
`;

const spriteVertex = /* glsl */ `
out vec2 vUv;
void main() {
	vUv = uv;
	vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
	vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
	center.xy += position.xy * scale;
	gl_Position = projectionMatrix * center;
}
`;

const blastFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform float uAge;
uniform float uKind;
uniform float uSeed;
uniform vec3 uSmoke;
out vec4 outColor;
${noise}
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length(p);
	float n = fbm(vec3(p * 2.2 + uSeed, uAge * 1.5 + uSeed));
	if (uKind < 0.5) {
		float core = exp(-r * r * 5.0) * (1.0 - smoothstep(0.0, 0.25, uAge));
		float ring = exp(-pow((r - 0.2 - uAge) * 6.0, 2.0)) * (1.0 - smoothstep(0.0, 0.18, uAge));
		vec3 color = vec3(1.0, 0.98, 0.92) * (core * 60.0 + ring * 8.0);
		outColor = vec4(color, 0.0);
		return;
	}
	float edge = 1.0 - smoothstep(0.55 + 0.35 * n, 1.0, r);
	float fire = edge * (1.0 - smoothstep(0.05, 0.45, uAge));
	float smoke = edge * smoothstep(0.08, 0.3, uAge) * (1.0 - smoothstep(0.9, 1.8, uAge)) * 0.7;
	vec3 hot = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.85, 0.5), n) * (6.0 + 20.0 * (1.0 - uAge * 3.0));
	vec3 color = hot * fire * n + uSmoke * smoke * (0.6 + 0.4 * n);
	float alpha = clamp(smoke * (0.4 + 0.6 * n), 0.0, 1.0);
	outColor = vec4(color, alpha);
}
`;

const glowFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform vec3 uColor;
out vec4 outColor;
void main() {
	float r = length(vUv * 2.0 - 1.0);
	float glow = exp(-r * r * 4.0);
	outColor = vec4(uColor * glow, 1.0);
}
`;

interface Smoke {
	mesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
}

interface Fire {
	flames: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	glow: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
}

function hash(value: number): number {
	let x = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
	x ^= x >>> 13;
	x = Math.imul(x, 0xc2b2ae35);
	return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function effectSeed(effect: ReplayEffect): number {
	return Math.abs(Math.round(effect.x * 7 + effect.y * 13 + effect.startTick)) % 1000;
}

export class GameEffects {
	readonly root = new THREE.Group();
	private smokes: Smoke[] = [];
	private fires: Fire[] = [];
	private blasts: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
	private muzzles: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
	private box = new THREE.BoxGeometry(2, 2, 2);
	private plane = new THREE.PlaneGeometry(1, 1);
	private flamePlane = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
	private disc = new THREE.CircleGeometry(1, 32);
	private tracers: THREE.LineSegments;
	private tracerPositions = new Float32Array(3 * 2 * 256);
	private light = new THREE.Vector3(1, 1, 1);
	private shadow = new THREE.Vector3(0.3, 0.3, 0.3);
	private matrix = new THREE.Matrix4();
	private quaternion = new THREE.Quaternion();
	private vector = new THREE.Vector3();
	private direction = new THREE.Vector3();
	private time = 0;

	constructor() {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			'position',
			new THREE.BufferAttribute(this.tracerPositions, 3).setUsage(THREE.DynamicDrawUsage)
		);
		this.tracers = new THREE.LineSegments(
			geometry,
			new THREE.LineBasicMaterial({
				color: new THREE.Color(5, 3.6, 1.6),
				transparent: true,
				blending: THREE.AdditiveBlending,
				depthWrite: false
			})
		);
		this.tracers.frustumCulled = false;
		this.root.add(this.tracers);
	}

	setShading(shading: WorldShading | null) {
		const sky = shading?.uniforms.uAmbientSky?.value as THREE.Vector3 | undefined;
		const sun = shading?.uniforms.uSunColor?.value as THREE.Vector3 | undefined;
		if (sky) {
			const luma = (v: THREE.Vector3) => v.x * 0.2126 + v.y * 0.7152 + v.z * 0.0722;
			const ambient = luma(sky);
			const direct = sun ? luma(sun) : 0;
			this.light.setScalar(ambient * 1.15 + direct * 0.12).multiply(SMOKE_TINT);
			this.shadow.setScalar(ambient * 0.45).multiply(SMOKE_TINT);
		}
	}

	update(
		replay: RoundReplay,
		tick: number,
		players: PlayerState[],
		camera: THREE.Camera,
		muzzle: (index: number, target: THREE.Vector3) => THREE.Vector3 | null,
		time: number
	) {
		this.time = time;
		const { meta } = replay;
		let smokes = 0;
		let fires = 0;
		let blasts = 0;
		for (const effect of meta.effects) {
			if (tick < effect.startTick || tick > effect.endTick) continue;
			const age = (tick - effect.startTick) / meta.tickRate;
			const left = (effect.endTick - tick) / meta.tickRate;
			if (effect.type === 'smoke')
				this.updateSmoke(this.smoke(smokes++), effect, age, left, camera);
			else if (effect.type === 'molotov')
				this.updateFire(this.fire(fires++), effect, age, left, camera);
			else if (effect.type === 'flash' || effect.type === 'he')
				this.updateBlast(this.blast(blasts++), effect, age);
		}
		for (let i = smokes; i < this.smokes.length; i++) this.smokes[i]!.mesh.visible = false;
		for (let i = fires; i < this.fires.length; i++) {
			this.fires[i]!.flames.visible = false;
			this.fires[i]!.glow.visible = false;
		}
		for (let i = blasts; i < this.blasts.length; i++) this.blasts[i]!.visible = false;
		this.updateShots(replay, tick, players, muzzle);
	}

	private smoke(index: number): Smoke {
		let smoke = this.smokes[index];
		if (!smoke) {
			const material = new THREE.ShaderMaterial({
				glslVersion: THREE.GLSL3,
				vertexShader: smokeVertex,
				fragmentShader: smokeFragment,
				uniforms: {
					uCamera: { value: new THREE.Vector3() },
					uCenter: { value: new THREE.Vector3() },
					uRadii: { value: new THREE.Vector3() },
					uGrowth: { value: 1 },
					uFade: { value: 1 },
					uSeed: { value: 0 },
					uTime: { value: 0 },
					uLight: { value: this.light },
					uShadow: { value: this.shadow }
				},
				transparent: true,
				depthWrite: false,
				blending: THREE.CustomBlending,
				blendSrc: THREE.OneFactor,
				blendDst: THREE.OneMinusSrcAlphaFactor
			});
			smoke = { mesh: new THREE.Mesh(this.box, material) };
			smoke.mesh.frustumCulled = false;
			smoke.mesh.renderOrder = 5;
			this.root.add(smoke.mesh);
			this.smokes.push(smoke);
		}
		smoke.mesh.visible = true;
		return smoke;
	}

	private updateSmoke(
		smoke: Smoke,
		effect: ReplayEffect,
		age: number,
		left: number,
		camera: THREE.Camera
	) {
		const mesh = smoke.mesh;
		const u = mesh.material.uniforms;
		const growth = 1 - Math.pow(1 - Math.min(1, age / SMOKE_BLOOM), 3);
		const center = (u.uCenter!.value as THREE.Vector3).set(
			effect.x,
			effect.y,
			effect.z + SMOKE_HEIGHT * 0.45
		);
		const radii = (u.uRadii!.value as THREE.Vector3).set(
			SMOKE_RADIUS,
			SMOKE_RADIUS,
			SMOKE_HEIGHT * 0.6
		);
		mesh.position.copy(center);
		mesh.scale.copy(radii);
		(u.uCamera!.value as THREE.Vector3).copy(camera.position);
		u.uGrowth!.value = 0.25 + 0.75 * growth;
		u.uFade!.value = Math.min(1, left / SMOKE_FADE) * Math.min(1, age * 4);
		u.uSeed!.value = effectSeed(effect) * 0.37;
		u.uTime!.value = this.time;
		const local = this.vector.copy(camera.position).sub(center).divide(radii);
		const inside = Math.max(Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)) < 1.02;
		mesh.material.side = inside ? THREE.BackSide : THREE.FrontSide;
		mesh.material.depthTest = !inside;
	}

	private fire(index: number): Fire {
		let fire = this.fires[index];
		if (!fire) {
			const material = new THREE.ShaderMaterial({
				glslVersion: THREE.GLSL3,
				vertexShader: flameVertex,
				fragmentShader: flameFragment,
				uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 } },
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide
			});
			const flames = new THREE.InstancedMesh(this.flamePlane, material, FIRE_FLAMES);
			const seeds = new Float32Array(FIRE_FLAMES).map((_, i) => hash(i * 17 + index * 101));
			flames.geometry = this.flamePlane.clone();
			flames.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
			flames.frustumCulled = false;
			flames.renderOrder = 6;
			const glow = new THREE.Mesh(
				this.disc,
				new THREE.ShaderMaterial({
					glslVersion: THREE.GLSL3,
					vertexShader: /* glsl */ `out vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
					fragmentShader: glowFragment,
					uniforms: { uColor: { value: new THREE.Vector3(3, 0.9, 0.2) } },
					transparent: true,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
					polygonOffset: true,
					polygonOffsetFactor: -2,
					polygonOffsetUnits: -8
				})
			);
			glow.renderOrder = 5;
			fire = { flames, glow };
			this.root.add(flames, glow);
			this.fires.push(fire);
		}
		fire.flames.visible = true;
		fire.glow.visible = true;
		return fire;
	}

	private updateFire(
		fire: Fire,
		effect: ReplayEffect,
		age: number,
		left: number,
		camera: THREE.Camera
	) {
		const seed = effectSeed(effect);
		const spread = Math.min(1, 0.3 + age / FIRE_GROW);
		const fade = Math.min(1, left / 0.8, age * 3);
		const yaw = Math.atan2(camera.position.y - effect.y, camera.position.x - effect.x);
		this.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, yaw - Math.PI / 2, 'ZXY'));
		for (let i = 0; i < FIRE_FLAMES; i++) {
			const angle = hash(seed * 31 + i) * Math.PI * 2;
			const distance = Math.sqrt(hash(seed * 57 + i * 3)) * FIRE_RADIUS * spread;
			const height = (30 + 50 * hash(seed + i * 11)) * (0.6 + 0.4 * fade);
			const width = height * (0.55 + 0.25 * hash(seed + i * 5));
			this.vector.set(
				effect.x + Math.cos(angle) * distance,
				effect.y + Math.sin(angle) * distance,
				effect.z + 1
			);
			this.matrix.compose(this.vector, this.quaternion, new THREE.Vector3(width, height, 1));
			fire.flames.setMatrixAt(i, this.matrix);
		}
		fire.flames.instanceMatrix.needsUpdate = true;
		fire.flames.material.uniforms.uTime!.value = this.time + seed;
		fire.flames.material.uniforms.uIntensity!.value = fade;
		fire.glow.position.set(effect.x, effect.y, effect.z + 2);
		fire.glow.scale.setScalar(FIRE_RADIUS * spread * 1.4);
		(fire.glow.material.uniforms.uColor!.value as THREE.Vector3)
			.set(2.5, 0.75, 0.15)
			.multiplyScalar(fade);
	}

	private blast(index: number) {
		let mesh = this.blasts[index];
		if (!mesh) {
			mesh = new THREE.Mesh(
				this.plane,
				new THREE.ShaderMaterial({
					glslVersion: THREE.GLSL3,
					vertexShader: spriteVertex,
					fragmentShader: blastFragment,
					uniforms: {
						uAge: { value: 0 },
						uKind: { value: 0 },
						uSeed: { value: 0 },
						uSmoke: { value: this.shadow }
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
			this.blasts.push(mesh);
		}
		mesh.visible = true;
		return mesh;
	}

	private updateBlast(
		mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>,
		effect: ReplayEffect,
		age: number
	) {
		const flash = effect.type === 'flash';
		if (age > (flash ? 0.4 : 2)) {
			mesh.visible = false;
			return;
		}
		const u = mesh.material.uniforms;
		u.uAge!.value = age;
		u.uKind!.value = flash ? 0 : 1;
		u.uSeed!.value = effectSeed(effect) * 0.1;
		mesh.position.set(effect.x, effect.y, effect.z + (flash ? 0 : 30));
		mesh.scale.setScalar(flash ? 160 : 260 * Math.min(1, 0.35 + age * 4));
	}

	private updateShots(
		replay: RoundReplay,
		tick: number,
		players: PlayerState[],
		muzzle: (index: number, target: THREE.Vector3) => THREE.Vector3 | null
	) {
		const { meta } = replay;
		let segments = 0;
		let flashes = 0;
		const maxAge = (TRACER_RANGE / TRACER_SPEED) * meta.tickRate;
		for (let i = 0; i < meta.shots.length; i += 2) {
			const shotTick = meta.shots[i]!;
			if (shotTick > tick) break;
			if (shotTick < tick - maxAge) continue;
			const index = meta.shots[i + 1]!;
			const shooter = players[index];
			if (!shooter?.alive) continue;
			const origin = muzzle(index, this.vector);
			if (!origin) continue;
			const yaw = shooter.yaw * DEG;
			const pitch = shooter.pitch * DEG;
			this.direction.set(
				Math.cos(pitch) * Math.cos(yaw),
				Math.cos(pitch) * Math.sin(yaw),
				-Math.sin(pitch)
			);
			const age = (tick - shotTick) / meta.tickRate;
			if (tick - shotTick <= MUZZLE_TICKS) {
				const flash = this.muzzle(flashes++);
				flash.position.copy(origin).addScaledVector(this.direction, 4);
				flash.scale.setScalar(18 + 10 * hash(shotTick + index));
			}
			if (segments < this.tracerPositions.length / 6 && hash(shotTick * 13 + index) < 0.5) {
				const head = Math.min(TRACER_RANGE, age * TRACER_SPEED);
				const tail = Math.max(0, head - TRACER_LENGTH);
				const o = segments * 6;
				this.tracerPositions[o] = origin.x + this.direction.x * tail;
				this.tracerPositions[o + 1] = origin.y + this.direction.y * tail;
				this.tracerPositions[o + 2] = origin.z + this.direction.z * tail;
				this.tracerPositions[o + 3] = origin.x + this.direction.x * head;
				this.tracerPositions[o + 4] = origin.y + this.direction.y * head;
				this.tracerPositions[o + 5] = origin.z + this.direction.z * head;
				segments++;
			}
		}
		const geometry = this.tracers.geometry;
		geometry.setDrawRange(0, segments * 2);
		(geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
		for (let i = flashes; i < this.muzzles.length; i++) this.muzzles[i]!.visible = false;
	}

	private muzzle(index: number) {
		let mesh = this.muzzles[index];
		if (!mesh) {
			mesh = new THREE.Mesh(
				this.plane,
				new THREE.ShaderMaterial({
					glslVersion: THREE.GLSL3,
					vertexShader: spriteVertex,
					fragmentShader: glowFragment,
					uniforms: { uColor: { value: new THREE.Vector3(30, 18, 6) } },
					transparent: true,
					depthWrite: false,
					blending: THREE.AdditiveBlending
				})
			);
			mesh.frustumCulled = false;
			mesh.renderOrder = 7;
			this.root.add(mesh);
			this.muzzles.push(mesh);
		}
		mesh.visible = true;
		return mesh;
	}

	dispose() {
		for (const smoke of this.smokes) smoke.mesh.material.dispose();
		for (const fire of this.fires) {
			fire.flames.geometry.dispose();
			fire.flames.material.dispose();
			fire.flames.dispose();
			fire.glow.material.dispose();
		}
		for (const mesh of [...this.blasts, ...this.muzzles]) mesh.material.dispose();
		this.tracers.geometry.dispose();
		(this.tracers.material as THREE.Material).dispose();
		for (const geometry of [this.box, this.plane, this.flamePlane, this.disc]) geometry.dispose();
	}
}
