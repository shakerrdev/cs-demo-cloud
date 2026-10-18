import * as THREE from 'three';

export const RAGDOLL_BONES = [
	'pelvis',
	'spine_2',
	'head_0',
	'arm_upper_L',
	'arm_lower_L',
	'hand_L',
	'arm_upper_R',
	'arm_lower_R',
	'hand_R',
	'leg_upper_L',
	'leg_lower_L',
	'ankle_L',
	'leg_upper_R',
	'leg_lower_R',
	'ankle_R'
] as const;

type Joint = (typeof RAGDOLL_BONES)[number];

const LINKS: [Joint, Joint][] = [
	['pelvis', 'spine_2'],
	['spine_2', 'head_0'],
	['spine_2', 'arm_upper_L'],
	['arm_upper_L', 'arm_lower_L'],
	['arm_lower_L', 'hand_L'],
	['spine_2', 'arm_upper_R'],
	['arm_upper_R', 'arm_lower_R'],
	['arm_lower_R', 'hand_R'],
	['pelvis', 'leg_upper_L'],
	['leg_upper_L', 'leg_lower_L'],
	['leg_lower_L', 'ankle_L'],
	['pelvis', 'leg_upper_R'],
	['leg_upper_R', 'leg_lower_R'],
	['leg_lower_R', 'ankle_R'],
	['arm_upper_L', 'arm_upper_R'],
	['leg_upper_L', 'leg_upper_R'],
	['pelvis', 'arm_upper_L'],
	['pelvis', 'arm_upper_R'],
	['spine_2', 'leg_upper_L'],
	['spine_2', 'leg_upper_R'],
	['pelvis', 'head_0'],
	['head_0', 'arm_upper_L'],
	['head_0', 'arm_upper_R']
];

const SWINGS: [Joint, Joint][] = [
	['spine_2', 'head_0'],
	['arm_upper_L', 'arm_lower_L'],
	['arm_lower_L', 'hand_L'],
	['arm_upper_R', 'arm_lower_R'],
	['arm_lower_R', 'hand_R'],
	['leg_upper_L', 'leg_lower_L'],
	['leg_lower_L', 'ankle_L'],
	['leg_upper_R', 'leg_lower_R'],
	['leg_lower_R', 'ankle_R']
];

const RADIUS: Partial<Record<Joint, number>> = { head_0: 5, pelvis: 6, spine_2: 7 };
const PUSH: Partial<Record<Joint, number>> = {
	head_0: 1,
	spine_2: 0.85,
	arm_upper_L: 0.8,
	arm_upper_R: 0.8,
	pelvis: 0.35
};

const RATE = 60;
const SECONDS = 1.8;
const GRAVITY = 800;
const ITERATIONS = 6;

export interface FallInput {
	yaw: number;
	room: number;
	floor: number;
	headshot: boolean;
	seed: number;
}

export class Ragdoll {
	private bones = new Map<Joint, THREE.Object3D>();
	private restPositions: THREE.Vector3[] = [];
	private restQuaternions: THREE.Quaternion[] = [];
	private frames: Float32Array;
	private count = 0;
	private v = new THREE.Vector3();
	private w = new THREE.Vector3();
	private q = new THREE.Quaternion();
	private parentQuaternion = new THREE.Quaternion();
	private basis = new THREE.Matrix4();
	private restBasis = new THREE.Matrix4();

	constructor(model: THREE.Object3D, input: FallInput) {
		for (const name of RAGDOLL_BONES) {
			const bone = model.getObjectByName(name);
			if (bone) this.bones.set(name, bone);
		}
		for (const name of RAGDOLL_BONES) {
			const bone = this.bones.get(name);
			this.restPositions.push(
				bone ? bone.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3()
			);
			this.restQuaternions.push(
				bone ? bone.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()
			);
		}
		this.frames = this.simulate(input);
	}

	get complete(): boolean {
		return this.bones.size === RAGDOLL_BONES.length;
	}

	private simulate(input: FallInput): Float32Array {
		const n = RAGDOLL_BONES.length;
		const steps = Math.round(SECONDS * RATE);
		const dt = 1 / RATE;
		const pos = this.restPositions.map((p) => p.clone());
		const prev = pos.map((p) => p.clone());
		const yaw = (input.yaw * Math.PI) / 180;
		const push = new THREE.Vector3(Math.cos(yaw), Math.sin(yaw), 0);
		const side = new THREE.Vector3(-push.y, push.x, 0);
		const random = (i: number) => {
			const x = Math.sin(input.seed * 12.9898 + i * 78.233) * 43758.5453;
			return x - Math.floor(x);
		};
		const speed = (input.headshot ? 230 : 170) * (0.85 + 0.3 * random(1));
		const twist = (random(2) - 0.5) * 90;
		RAGDOLL_BONES.forEach((name, i) => {
			const share = PUSH[name] ?? 0.1;
			const lateral = name.endsWith('_L') ? twist : name.endsWith('_R') ? -twist : 0;
			this.v
				.copy(push)
				.multiplyScalar(speed * share)
				.addScaledVector(side, lateral * share)
				.multiplyScalar(dt);
			prev[i]!.sub(this.v);
		});
		const lengths = LINKS.map(([a, b]) =>
			pos[RAGDOLL_BONES.indexOf(a)]!.distanceTo(pos[RAGDOLL_BONES.indexOf(b)]!)
		);
		const links = LINKS.map(([a, b]) => [RAGDOLL_BONES.indexOf(a), RAGDOLL_BONES.indexOf(b)]);
		const origin = this.restPositions[0]!.clone();
		const limit = input.room + 18;
		const frames = new Float32Array(steps * n * 3);
		for (let step = 0; step < steps; step++) {
			for (let i = 0; i < n; i++) {
				const p = pos[i]!;
				const o = prev[i]!;
				this.v.copy(p).sub(o).multiplyScalar(0.995);
				o.copy(p);
				p.add(this.v);
				p.z -= GRAVITY * dt * dt;
			}
			for (let iteration = 0; iteration < ITERATIONS; iteration++) {
				for (let l = 0; l < links.length; l++) {
					const [a, b] = links[l]!;
					const pa = pos[a!]!;
					const pb = pos[b!]!;
					this.v.copy(pb).sub(pa);
					const distance = this.v.length() || 1e-6;
					const correction = (distance - lengths[l]!) / distance / 2;
					pa.addScaledVector(this.v, correction);
					pb.addScaledVector(this.v, -correction);
				}
				for (let i = 0; i < n; i++) {
					const p = pos[i]!;
					const floor = input.floor + (RADIUS[RAGDOLL_BONES[i]!] ?? 3);
					if (p.z < floor) {
						p.z = floor;
						const o = prev[i]!;
						o.x += (p.x - o.x) * 0.35;
						o.y += (p.y - o.y) * 0.35;
					}
					const along = this.w.copy(p).sub(origin).dot(push);
					if (along > limit) p.addScaledVector(push, limit - along);
				}
			}
			for (let i = 0; i < n; i++) pos[i]!.toArray(frames, (step * n + i) * 3);
		}
		this.count = steps;
		return frames;
	}

	apply(seconds: number) {
		if (!this.complete) return;
		const n = RAGDOLL_BONES.length;
		const step = Math.min(this.count - 1, Math.max(0, Math.floor(seconds * RATE)));
		const at = (name: Joint, target: THREE.Vector3) =>
			target.fromArray(this.frames, (step * n + RAGDOLL_BONES.indexOf(name)) * 3);
		const rest = (name: Joint) => this.restPositions[RAGDOLL_BONES.indexOf(name)]!;

		const pelvis = this.bones.get('pelvis')!;
		const up = at('spine_2', new THREE.Vector3()).sub(at('pelvis', this.v)).normalize();
		const across = at('leg_upper_R', new THREE.Vector3())
			.sub(at('leg_upper_L', this.v))
			.normalize();
		const restUp = rest('spine_2').clone().sub(rest('pelvis')).normalize();
		const restAcross = rest('leg_upper_R').clone().sub(rest('leg_upper_L')).normalize();
		frame(this.basis, up, across);
		frame(this.restBasis, restUp, restAcross);
		this.q
			.setFromRotationMatrix(this.basis.multiply(this.restBasis.transpose()))
			.multiply(this.restQuaternions[0]!);
		setWorld(pelvis, this.q, this.parentQuaternion);
		const world = at('pelvis', new THREE.Vector3());
		pelvis.parent?.worldToLocal(world);
		pelvis.position.copy(world);
		pelvis.updateMatrixWorld(true);

		for (const [name, child] of SWINGS) {
			const bone = this.bones.get(name)!;
			const restDirection = rest(child).clone().sub(rest(name)).normalize();
			const direction = at(child, new THREE.Vector3()).sub(at(name, this.v)).normalize();
			this.q
				.setFromUnitVectors(restDirection, direction)
				.multiply(this.restQuaternions[RAGDOLL_BONES.indexOf(name)]!);
			setWorld(bone, this.q, this.parentQuaternion);
			bone.updateMatrixWorld(true);
		}
	}
}

function frame(target: THREE.Matrix4, up: THREE.Vector3, across: THREE.Vector3) {
	const x = across.clone().addScaledVector(up, -across.dot(up)).normalize();
	const z = up;
	const y = new THREE.Vector3().crossVectors(z, x);
	target.makeBasis(x, y, z);
}

function setWorld(bone: THREE.Object3D, world: THREE.Quaternion, scratch: THREE.Quaternion) {
	if (bone.parent) bone.parent.getWorldQuaternion(scratch).invert();
	else scratch.identity();
	bone.quaternion.copy(scratch.multiply(world));
}
