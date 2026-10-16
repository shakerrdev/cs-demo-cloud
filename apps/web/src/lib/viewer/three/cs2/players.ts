import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
	LOCOMOTION_DIRECTIONS,
	weaponClass,
	weaponKey,
	weaponModelKey,
	weaponPoseName,
	weaponShootName,
	type PlayerPackManifest,
	type RoundReplay,
	type Side
} from '@cs-demo-cloud/replay';
import { playerMotion, type PlayerState } from '../../frame.ts';
import { createCs2Material, type MaterialExtras, type WorldShading } from './material.ts';
import {
	createTexture,
	fetchPackTexture,
	supportsFormat,
	textureSupport,
	type TextureSupport
} from './textures.ts';
import type { TextureQuality } from './pack.ts';

const BASE = '/maps/3d/players';
const CONCURRENT_DOWNLOADS = 4;
const DEG = Math.PI / 180;

const INCH = 1 / 0.0254;
const GLTF_TO_SOURCE = new THREE.Matrix4().set(
	0,
	0,
	INCH,
	0,
	INCH,
	0,
	0,
	0,
	0,
	INCH,
	0,
	0,
	0,
	0,
	0,
	1
);

const WALK_SPEED = 130;
const RUN_SPEED = 250;
const CROUCH_SPEED = 85;
const MOVING = 12;
const AIRBORNE = 90;
const DEATH_FALL = 0.55;
const PLANT_SECONDS = 3.3;
const SPINE_BONES = ['spine_1', 'spine_2', 'spine_3'];
const ADDITIVE_SKIP = new Set(['root_motion', 'pelvis', 'wpnPivot', 'wpn']);

type LocomotionClass = 'rifle' | 'pistol' | 'knife';

interface TextureJob {
	file: string;
	srgb: boolean;
	targets: THREE.IUniform[];
	texture?: THREE.Texture;
}

interface LoadedWeapon {
	scene: THREE.Object3D;
	offset: THREE.Matrix4;
}

interface Template {
	scene: THREE.Object3D;
	materials: Map<THREE.Mesh, MaterialExtras>;
}

function boneOf(track: THREE.KeyframeTrack): string {
	return track.name.slice(0, track.name.lastIndexOf('.'));
}

function hash(value: number): number {
	let x = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
	x ^= x >>> 13;
	x = Math.imul(x, 0xc2b2ae35);
	return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export class PlayerPack {
	readonly manifest: PlayerPackManifest;
	private clips = new Map<string, THREE.AnimationClip>();
	private names = new Map<Side, Set<string>>();
	private templates: Record<Side, Template>;
	private weapons = new Map<string, Promise<LoadedWeapon | null>>();
	private support: TextureSupport;
	private quality: Exclude<TextureQuality, 'auto'>;
	private version: string;
	private jobs = new Map<string, TextureJob>();
	private queue: TextureJob[] = [];
	private active = 0;
	private abort = new AbortController();
	private materials = new Map<string, THREE.ShaderMaterial>();
	private shading: WorldShading | null = null;
	onChange: (() => void) | null = null;

	private constructor(
		manifest: PlayerPackManifest,
		version: string,
		support: TextureSupport,
		quality: TextureQuality,
		templates: Record<Side, Template>,
		clips: THREE.AnimationClip[]
	) {
		this.manifest = manifest;
		this.version = version;
		this.support = support;
		this.quality = quality === 'auto' ? 'high' : quality;
		this.templates = templates;
		for (const clip of clips) this.clips.set(clip.name, clip);
	}

	static async load(
		renderer: THREE.WebGLRenderer,
		version: string,
		quality: TextureQuality = 'auto'
	): Promise<PlayerPack> {
		const url = (file: string) => `${BASE}/${file}?v=${version}`;
		const response = await fetch(url('players.json'));
		if (!response.ok) throw new Error(`Player models could not be loaded (${response.status})`);
		const manifest = (await response.json()) as PlayerPackManifest;
		const loader = new GLTFLoader();
		loader.setMeshoptDecoder(MeshoptDecoder);
		const parse = async (file: string) => {
			const result = await fetch(url(file));
			if (!result.ok) throw new Error(`${file} answered ${result.status}`);
			return loader.parseAsync(await result.arrayBuffer(), '');
		};
		const [animations, ct, t] = await Promise.all([
			parse(manifest.animations),
			parse(manifest.characters.CT),
			parse(manifest.characters.T)
		]);
		const template = (scene: THREE.Object3D): Template => {
			const materials = new Map<THREE.Mesh, MaterialExtras>();
			scene.traverse((object) => {
				const mesh = object as THREE.Mesh;
				if (!mesh.isMesh) return;
				const original = mesh.material as THREE.Material;
				materials.set(mesh, original.userData as MaterialExtras);
				mesh.frustumCulled = false;
			});
			return { scene, materials };
		};
		return new PlayerPack(
			manifest,
			version,
			textureSupport(renderer),
			quality,
			{ CT: template(ct.scene), T: template(t.scene) },
			animations.animations
		);
	}

	clip(name: string, side: Side): THREE.AnimationClip | undefined {
		const key = `${side}:${name}`;
		const cached = this.clips.get(key);
		if (cached) return cached;
		const source = this.clips.get(name);
		if (!source) return undefined;
		const nodes = this.nodeNames(side);
		const clip = new THREE.AnimationClip(
			key,
			source.duration,
			source.tracks.filter((track) => nodes.has(boneOf(track)))
		);
		this.clips.set(key, clip);
		return clip;
	}

	additiveClip(name: string, side: Side): THREE.AnimationClip | undefined {
		const key = `${side}:+${name}`;
		const cached = this.clips.get(key);
		if (cached) return cached;
		const source = this.clip(name, side);
		if (!source) return undefined;
		const rest = this.templates[side].scene;
		const tracks = source.tracks.filter(
			(track) => track.name.endsWith('.quaternion') && !ADDITIVE_SKIP.has(boneOf(track))
		);
		const reference = tracks.map(
			(track) =>
				new THREE.QuaternionKeyframeTrack(
					track.name,
					[0],
					rest.getObjectByName(boneOf(track))!.quaternion.toArray()
				)
		);
		const clip = THREE.AnimationUtils.makeClipAdditive(
			new THREE.AnimationClip(
				key,
				source.duration,
				tracks.map((track) => track.clone())
			),
			0,
			new THREE.AnimationClip('rest', 0, reference)
		);
		this.clips.set(key, clip);
		return clip;
	}

	private nodeNames(side: Side): Set<string> {
		let names = this.names.get(side);
		if (!names) {
			names = new Set();
			this.templates[side].scene.traverse((object) => names!.add(object.name));
			this.names.set(side, names);
		}
		return names;
	}

	setShading(shading: WorldShading | null) {
		if (shading === this.shading) return;
		this.shading = shading;
		for (const material of this.materials.values()) material.dispose();
		this.materials.clear();
	}

	material(extras: MaterialExtras): THREE.ShaderMaterial | null {
		if (!this.shading) return null;
		const key = JSON.stringify(extras.vmat?.Name ?? 'default') + JSON.stringify(extras.tint ?? []);
		let material = this.materials.get(key);
		if (!material) {
			material = createCs2Material(extras, this.shading, (path, srgb, target) =>
				this.requestTexture(path, srgb, target)
			);
			material.stencilWrite = true;
			material.stencilRef = 1;
			material.stencilZPass = THREE.ReplaceStencilOp;
			this.materials.set(key, material);
		}
		return material;
	}

	createModel(side: Side): { root: THREE.Object3D; meshes: THREE.SkinnedMesh[] } {
		const template = this.templates[side];
		const root = cloneSkinned(template.scene);
		const meshes: THREE.SkinnedMesh[] = [];
		const sources: THREE.Mesh[] = [];
		template.scene.traverse((object) => {
			if ((object as THREE.Mesh).isMesh) sources.push(object as THREE.Mesh);
		});
		let index = 0;
		root.traverse((object) => {
			const mesh = object as THREE.SkinnedMesh;
			if (!mesh.isMesh) return;
			const source = sources[index++];
			const extras = source ? template.materials.get(source) : undefined;
			mesh.userData.extras = extras ?? {};
			mesh.frustumCulled = false;
			if (mesh.isSkinnedMesh) meshes.push(mesh);
		});
		return { root, meshes };
	}

	weapon(key: string): Promise<LoadedWeapon | null> {
		let promise = this.weapons.get(key);
		if (!promise) {
			const entry = this.manifest.weapons[key];
			promise = entry
				? (async () => {
						const response = await fetch(`${BASE}/${entry.model}?v=${this.version}`, {
							signal: this.abort.signal
						});
						if (!response.ok) return null;
						const loader = new GLTFLoader();
						loader.setMeshoptDecoder(MeshoptDecoder);
						const gltf = await loader.parseAsync(await response.arrayBuffer(), '');
						gltf.scene.traverse((object) => {
							const mesh = object as THREE.Mesh;
							if (!mesh.isMesh) return;
							mesh.userData.extras = (mesh.material as THREE.Material).userData;
							mesh.frustumCulled = false;
						});
						const offset = new THREE.Matrix4()
							.compose(
								new THREE.Vector3().fromArray(entry.translation),
								new THREE.Quaternion().fromArray(entry.rotation),
								new THREE.Vector3(1, 1, 1)
							)
							.invert();
						return { scene: gltf.scene, offset };
					})().catch(() => null)
				: Promise.resolve(null);
			this.weapons.set(key, promise);
		}
		return promise;
	}

	private requestTexture(path: string, srgb: boolean, target: THREE.IUniform) {
		const ref = this.manifest.textures[path];
		if (!ref || !supportsFormat(this.support, ref.format)) return;
		const file = this.quality === 'low' && ref.low ? ref.low.file : ref.file;
		const key = `${file}|${srgb}`;
		let job = this.jobs.get(key);
		if (!job) {
			job = { file, srgb, targets: [] };
			this.jobs.set(key, job);
			this.queue.push(job);
			this.pump();
		}
		job.targets.push(target);
		if (job.texture) target.value = job.texture;
	}

	private pump() {
		while (this.active < CONCURRENT_DOWNLOADS && this.queue.length) {
			const job = this.queue.shift()!;
			this.active++;
			fetchPackTexture(`${BASE}/${job.file}?v=${this.version}`, this.abort.signal)
				.then((packed) => {
					if (this.abort.signal.aborted) return;
					job.texture = createTexture(packed, {
						srgb: job.srgb,
						anisotropy: Math.min(8, this.support.anisotropy),
						maxSize: this.quality === 'medium' ? 512 : undefined
					});
					for (const target of job.targets) target.value = job.texture;
					this.onChange?.();
				})
				.catch((error: Error) => {
					if (!this.abort.signal.aborted)
						console.warn(`Texture ${job.file} failed: ${error.message}`);
				})
				.finally(() => {
					this.active--;
					if (!this.abort.signal.aborted) this.pump();
				});
		}
	}

	dispose() {
		this.abort.abort();
		for (const job of this.jobs.values()) job.texture?.dispose();
		for (const material of this.materials.values()) material.dispose();
		for (const template of Object.values(this.templates))
			template.scene.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
	}
}

class PlayerModel {
	readonly root = new THREE.Group();
	readonly side: Side;
	private model: THREE.Object3D;
	private meshes: THREE.SkinnedMesh[];
	private ghosts: THREE.SkinnedMesh[] = [];
	private ghostMaterial: THREE.MeshBasicMaterial;
	private mixer: THREE.AnimationMixer;
	private actions = new Map<string, THREE.AnimationAction>();
	private spine: THREE.Bone[] = [];
	private touched: {
		bone: THREE.Object3D;
		quaternion: THREE.Quaternion;
		position: THREE.Vector3;
	}[] = [];
	private wpn: THREE.Object3D | null;
	private handR: THREE.Object3D | null;
	private grip = new THREE.Matrix4();
	private matrix = new THREE.Matrix4();
	private scale = new THREE.Vector3();
	private weaponSlot = new THREE.Group();
	private weaponKey: string | null = null;
	private weaponLoading: string | null = null;
	private pack: PlayerPack;
	private shading: WorldShading | null = null;
	private quaternion = new THREE.Quaternion();
	private parentQuaternion = new THREE.Quaternion();
	private rotation = new THREE.Quaternion();
	private axis = new THREE.Vector3();

	constructor(pack: PlayerPack, side: Side, color: number) {
		this.pack = pack;
		this.side = side;
		const { root, meshes } = pack.createModel(side);
		this.model = root;
		this.meshes = meshes;
		this.model.matrixAutoUpdate = false;
		this.model.matrix.copy(GLTF_TO_SOURCE);
		this.root.add(this.model);
		this.mixer = new THREE.AnimationMixer(this.model);

		this.ghostMaterial = new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 0.3,
			depthWrite: false,
			depthFunc: THREE.GreaterDepth,
			stencilWrite: true,
			stencilRef: 1,
			stencilFunc: THREE.NotEqualStencilFunc
		});
		for (const mesh of meshes) {
			const ghost = new THREE.SkinnedMesh(mesh.geometry, this.ghostMaterial);
			ghost.bind(mesh.skeleton, mesh.bindMatrix);
			ghost.frustumCulled = false;
			ghost.renderOrder = 3;
			mesh.parent?.add(ghost);
			this.ghosts.push(ghost);
		}

		for (const name of SPINE_BONES) {
			const bone = this.model.getObjectByName(name) as THREE.Bone | undefined;
			if (bone) this.spine.push(bone);
		}
		this.wpn = this.model.getObjectByName('wpn') ?? null;
		this.handR = this.model.getObjectByName('hand_R') ?? null;
		for (const bone of [...this.spine, this.wpn]) {
			if (bone)
				this.touched.push({
					bone,
					quaternion: bone.quaternion.clone(),
					position: bone.position.clone()
				});
		}
		this.weaponSlot.matrixAutoUpdate = false;
		(this.wpn ?? this.handR)?.add(this.weaponSlot);
		this.root.visible = false;
	}

	setShading(shading: WorldShading | null) {
		if (shading === this.shading) return;
		this.shading = shading;
		for (const mesh of this.meshes) this.applyMaterial(mesh);
		this.weaponSlot.traverse((object) => {
			if ((object as THREE.Mesh).isMesh) this.applyMaterial(object as THREE.Mesh);
		});
	}

	private applyMaterial(mesh: THREE.Mesh) {
		const material = this.pack.material((mesh.userData.extras ?? {}) as MaterialExtras);
		if (material) mesh.material = material;
	}

	private action(name: string): THREE.AnimationAction | null {
		let action = this.actions.get(name);
		if (action) return action;
		const clip = this.pack.clip(name, this.side);
		if (!clip) return null;
		action = this.mixer.clipAction(clip);
		action.play();
		action.weight = 0;
		this.actions.set(name, action);
		return action;
	}

	private additive(name: string): THREE.AnimationAction | null {
		const key = `+${name}`;
		let action = this.actions.get(key);
		if (action) return action;
		const additive = this.pack.additiveClip(name, this.side);
		if (!additive) return null;
		action = this.mixer.clipAction(additive);
		action.blendMode = THREE.AdditiveAnimationBlendMode;
		action.play();
		action.weight = 0;
		this.actions.set(key, action);
		return action;
	}

	private set(name: string | null, weight: number, time: number, additive = false) {
		if (!name || weight <= 0.001) return;
		const action = additive ? this.additive(name) : this.action(name);
		if (!action) return;
		const duration = action.getClip().duration;
		action.weight += weight;
		action.time = duration > 0 ? ((time % duration) + duration) % duration : 0;
	}

	private setOnce(name: string | null, weight: number, time: number, additive = false) {
		if (!name || weight <= 0.001) return;
		const action = additive ? this.additive(name) : this.action(name);
		if (!action) return;
		action.weight += weight;
		action.time = Math.max(0, Math.min(action.getClip().duration, time));
	}

	private setWeapon(key: string | null) {
		if (key === this.weaponKey && this.weaponLoading === null) return;
		if (key === this.weaponLoading) return;
		this.weaponKey = key;
		this.weaponSlot.clear();
		if (!key) return;
		this.weaponLoading = key;
		void this.pack.weapon(key).then((template) => {
			if (this.weaponLoading !== key) return;
			this.weaponLoading = null;
			if (!template || this.weaponKey !== key) return;
			const weapon = template.scene.clone();
			weapon.traverse((object) => {
				if ((object as THREE.Mesh).isMesh) this.applyMaterial(object as THREE.Mesh);
			});
			this.weaponSlot.matrix.copy(template.offset);
			this.weaponSlot.add(weapon);
		});
	}

	update(replay: RoundReplay, tick: number, player: PlayerState, visible: boolean, ghost: boolean) {
		const kill = player.alive
			? undefined
			: replay.meta.kills.find((k) => k.victim === player.index && k.tick <= tick);
		this.root.visible = visible && (player.alive || kill !== undefined);
		if (!this.root.visible) return;
		for (const mesh of this.ghosts) mesh.visible = ghost && player.alive;

		const meta = replay.meta;
		const seconds = (tick - meta.startTick) / meta.tickRate;
		for (const action of this.actions.values()) action.weight = 0;

		const key = weaponKey(player.weapon);
		const kind = weaponClass(key);
		const base: LocomotionClass = kind === 'rifle' || kind === 'pistol' ? kind : 'knife';
		const crouch = player.ducking;
		let fall = 0;

		if (!player.alive && kill) {
			const since = (tick - kill.tick) / meta.tickRate;
			fall = Math.min(1, since / DEATH_FALL);
			this.root.position.set(kill.x, kill.y, kill.z);
			this.set(crouch ? `idle_crouch_${base}` : `idle_${base}`, 1, 0);
			this.setWeapon(null);
		} else {
			this.root.position.set(player.x, player.y, player.z);
			this.setWeapon(weaponModelKey(key, player.side));
			this.locomotion(replay, tick, player, base, seconds);
			const pose = weaponPoseName(key);
			if (pose) this.set(crouch ? `idle_crouch_${pose}` : `idle_${pose}`, 1, 0, true);
			this.shoot(replay, tick, player, key);
		}

		this.root.rotation.set(0, 0, player.yaw * DEG);
		this.pose();
		if (fall > 0) {
			const side = hash(player.index * 31 + meta.round) < 0.5 ? 1 : -1;
			const eased = fall * fall * (3 - 2 * fall);
			this.root.rotateY(-eased * 88 * DEG);
			this.root.rotateX(side * eased * 12 * DEG);
			this.root.position.z += eased * 4;
		}
		this.root.updateMatrixWorld(true);
		if (player.alive) this.aim(player);
	}

	private pose() {
		for (const { bone, quaternion, position } of this.touched) {
			bone.quaternion.copy(quaternion);
			bone.position.copy(position);
		}
		const layers: [THREE.AnimationAction, number][] = [];
		for (const [name, action] of this.actions)
			if (name.startsWith('+') && action.weight > 0) {
				layers.push([action, action.weight]);
				action.weight = 0;
			}
		this.mixer.update(0);
		const keepGrip = layers.length > 0 && this.wpn && this.handR;
		if (keepGrip) {
			this.root.updateMatrixWorld(true);
			this.grip.copy(this.handR!.matrixWorld).invert().multiply(this.wpn!.matrixWorld);
			for (const [action, weight] of layers) action.weight = weight;
			this.mixer.update(0);
		}
		for (const entry of this.touched) {
			entry.quaternion.copy(entry.bone.quaternion);
			entry.position.copy(entry.bone.position);
		}
		this.root.updateMatrixWorld(true);
		if (keepGrip) {
			const parent = this.wpn!.parent!;
			this.matrix
				.copy(parent.matrixWorld)
				.invert()
				.multiply(this.handR!.matrixWorld)
				.multiply(this.grip)
				.decompose(this.wpn!.position, this.wpn!.quaternion, this.scale);
			this.wpn!.updateMatrixWorld(true);
		}
	}

	private locomotion(
		replay: RoundReplay,
		tick: number,
		player: PlayerState,
		base: LocomotionClass,
		seconds: number
	) {
		const meta = replay.meta;
		const crouch = player.ducking;

		if (player.defusing) {
			this.set(crouch ? `defuse_crouch_loop_${base}` : `defuse_loop_${base}`, 1, seconds);
			return;
		}
		const plant = [...meta.bomb]
			.reverse()
			.find((event) => event.player === player.index && event.tick <= tick);
		if (plant?.type === 'plant_start' && (tick - plant.tick) / meta.tickRate < PLANT_SECONDS) {
			this.setOnce(crouch ? 'planting_crouch' : 'planting', 1, (tick - plant.tick) / meta.tickRate);
			return;
		}

		const motion = playerMotion(replay, player.index, tick);
		if (Math.abs(motion.vertical) > AIRBORNE && !crouch) {
			this.set(`inair_stand_${base}`, 1, seconds);
			return;
		}

		const idle = crouch ? `idle_crouch_${base}` : `idle_${base}`;
		const moving = Math.min(1, Math.max(0, (motion.speed - MOVING) / 30));
		this.set(idle, 1 - moving, seconds);
		if (moving <= 0) return;

		const local = motion.direction - player.yaw * DEG;
		const sector = (((local / (Math.PI / 4)) % 8) + 8) % 8;
		const d0 = Math.floor(sector) % 8;
		const d1 = (d0 + 1) % 8;
		const t = sector - Math.floor(sector);
		const directions = [
			[LOCOMOTION_DIRECTIONS[d0]!, (1 - t) * moving],
			[LOCOMOTION_DIRECTIONS[d1]!, t * moving]
		] as const;

		if (crouch) {
			const cycle = CROUCH_SPEED * 0.8;
			for (const [direction, weight] of directions)
				this.set(`crouch_${direction}_${base}`, weight, (motion.distance / cycle) * 0.8);
			return;
		}
		const run = Math.min(1, Math.max(0, (motion.speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
		for (const [direction, weight] of directions) {
			this.set(`walk_${direction}_${base}`, weight * (1 - run), motion.distance / WALK_SPEED);
			this.set(`run_${direction}_${base}`, weight * run, (motion.distance / RUN_SPEED) * 0.7333);
		}
	}

	private shoot(replay: RoundReplay, tick: number, player: PlayerState, key: string | null) {
		const name = weaponShootName(key);
		if (!name) return;
		const shots = replay.meta.shots;
		let last = -1;
		for (let i = 0; i < shots.length; i += 2) {
			if (shots[i + 1] !== player.index) continue;
			if (shots[i]! > tick) break;
			last = shots[i]!;
		}
		if (last < 0) return;
		const since = (tick - last) / replay.meta.tickRate;
		const clip = this.pack.clip(name, this.side);
		if (!clip || since > clip.duration) return;
		this.setOnce(name, 1, since, true);
	}

	muzzle(player: PlayerState, target: THREE.Vector3): THREE.Vector3 | null {
		if (!this.root.visible || !this.wpn) return null;
		const kind = weaponClass(weaponKey(player.weapon));
		if (kind !== 'rifle' && kind !== 'pistol') return null;
		const yaw = player.yaw * DEG;
		const pitch = player.pitch * DEG;
		this.wpn.getWorldPosition(target);
		return target.add(
			this.axis
				.set(Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch))
				.multiplyScalar(kind === 'rifle' ? 24 : 9)
		);
	}

	private aim(player: PlayerState) {
		if (!this.spine.length) return;
		const yaw = player.yaw * DEG;
		this.axis.set(Math.sin(yaw), -Math.cos(yaw), 0);
		const share = (-player.pitch * DEG) / this.spine.length;
		this.rotation.setFromAxisAngle(this.axis, share);
		for (const bone of this.spine) {
			const parent = bone.parent;
			if (!parent) continue;
			bone.getWorldQuaternion(this.quaternion);
			parent.getWorldQuaternion(this.parentQuaternion);
			this.quaternion.premultiply(this.rotation);
			bone.quaternion.copy(this.parentQuaternion.invert().multiply(this.quaternion));
			bone.updateMatrixWorld(true);
		}
	}

	dispose() {
		this.mixer.stopAllAction();
		this.ghostMaterial.dispose();
	}
}

export class PlayerModels {
	readonly root = new THREE.Group();
	private pack: PlayerPack;
	private models: PlayerModel[] = [];
	private shading: WorldShading | null = null;

	constructor(pack: PlayerPack) {
		this.pack = pack;
	}

	setShading(shading: WorldShading | null) {
		this.shading = shading;
		this.pack.setShading(shading);
		for (const model of this.models) model.setShading(shading);
	}

	get active(): boolean {
		return this.shading !== null;
	}

	setPlayers(sides: Side[], colors: Record<Side, number>) {
		for (const model of this.models) {
			this.root.remove(model.root);
			model.dispose();
		}
		this.models = sides.map((side) => {
			const model = new PlayerModel(this.pack, side, colors[side]);
			model.setShading(this.shading);
			this.root.add(model.root);
			return model;
		});
	}

	update(
		replay: RoundReplay,
		tick: number,
		players: PlayerState[],
		pov: number | null,
		ghosts: boolean
	) {
		this.root.visible = this.active;
		if (!this.active) return;
		players.forEach((player, i) => {
			this.models[i]?.update(replay, tick, player, player.present && i !== pov, ghosts);
		});
	}

	muzzle(player: PlayerState, target: THREE.Vector3): THREE.Vector3 | null {
		return this.active ? (this.models[player.index]?.muzzle(player, target) ?? null) : null;
	}

	dispose() {
		for (const model of this.models) model.dispose();
		this.pack.dispose();
	}
}
