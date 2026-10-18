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
	type GrenadeType,
	itemWeaponKey,
	skinWeaponKey,
	type PlayerPackManifest,
	type ReplaySkin,
	type RoundReplay,
	type Side,
	type SkinsPackManifest
} from '@cs-demo-cloud/replay';
import { bombState, grenadePosition, playerMotion, type PlayerState } from '../../frame.ts';
import {
	createCs2Material,
	type GloveExtras,
	type MaterialExtras,
	type PaintExtras,
	type WorldShading
} from './material.ts';
import {
	createTexture,
	fetchPackTexture,
	textureUploader,
	type TextureUploader,
	supportsFormat,
	textureSupport,
	type TextureSupport
} from './textures.ts';
import type { TextureQuality } from './pack.ts';
import { Viewmodel, type PovPose } from './viewmodel.ts';

const BASE = '/maps/3d/players';
const SKINS_BASE = '/maps/3d/skins';
const CONCURRENT_DOWNLOADS = 4;
const DEG = Math.PI / 180;

const INCH = 1 / 0.0254;
export const GLTF_TO_SOURCE = new THREE.Matrix4().set(
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
	path: string;
	file: string;
	srgb: boolean;
	targets: THREE.IUniform[];
	texture?: THREE.Texture;
}

export interface ViewmodelAnimations {
	clips: Map<string, THREE.AnimationClip>;
	rigs: Map<string, THREE.Object3D>;
}

export interface LoadedWeapon {
	scene: THREE.Object3D;
	offset: THREE.Matrix4;
}

interface Template {
	scene: THREE.Object3D;
	materials: Map<THREE.Mesh, MaterialExtras>;
}

export function isFirstPerson(mesh: THREE.Object3D): boolean {
	return (mesh.userData.extras as { part?: string } | undefined)?.part === 'firstperson';
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
	private viewmodelClips: Promise<ViewmodelAnimations> | null = null;
	private skins: SkinsPackManifest | null;
	private uploader: TextureUploader;
	private skinsVersion: string | null;
	private agents = new Map<string, Promise<Template | null>>();
	private loadedAgents = new Map<string, Template>();
	private gloves = new Map<string, Promise<Template | null>>();
	onChange: (() => void) | null = null;

	private constructor(
		manifest: PlayerPackManifest,
		version: string,
		support: TextureSupport,
		quality: TextureQuality,
		templates: Record<Side, Template>,
		clips: THREE.AnimationClip[],
		skins: SkinsPackManifest | null,
		skinsVersion: string | null,
		uploader: TextureUploader
	) {
		this.uploader = uploader;
		this.manifest = manifest;
		this.skins = skins;
		this.skinsVersion = skinsVersion;
		this.version = version;
		this.support = support;
		this.quality = quality === 'auto' ? 'high' : quality;
		this.templates = templates;
		for (const clip of clips) this.clips.set(clip.name, clip);
	}

	static async load(
		renderer: THREE.WebGLRenderer,
		version: string,
		quality: TextureQuality = 'auto',
		skinsVersion: string | null = null
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
		const skins = skinsVersion
			? await fetch(`${SKINS_BASE}/skins.json?v=${skinsVersion}`)
					.then((result) => (result.ok ? (result.json() as Promise<SkinsPackManifest>) : null))
					.catch(() => null)
			: null;
		const [animations, ct, t] = await Promise.all([
			parse(manifest.animations),
			parse(manifest.characters.CT),
			parse(manifest.characters.T)
		]);
		return new PlayerPack(
			manifest,
			version,
			textureSupport(renderer),
			quality,
			{ CT: makeTemplate(ct.scene), T: makeTemplate(t.scene) },
			animations.animations,
			skins,
			skins ? skinsVersion : null,
			textureUploader(renderer)
		);
	}

	template(side: Side, agent?: string): Template {
		return (agent && this.loadedAgents.get(agent)) || this.templates[side];
	}

	hasAgent(agent: string): boolean {
		return Boolean(this.skins?.agents[agent]);
	}

	loadAgent(agent: string): Promise<Template | null> {
		let promise = this.agents.get(agent);
		if (!promise) {
			const file = this.skins?.agents[agent];
			promise = file
				? this.fetchGltf(`${SKINS_BASE}/${file}?v=${this.skinsVersion}`)
						.then((gltf) => {
							const template = makeTemplate(gltf.scene);
							this.loadedAgents.set(agent, template);
							return template;
						})
						.catch(() => null)
				: Promise.resolve(null);
			this.agents.set(agent, promise);
		}
		return promise;
	}

	private async fetchGltf(url: string) {
		const response = await fetch(url, { signal: this.abort.signal });
		if (!response.ok) throw new Error(`${url} answered ${response.status}`);
		const loader = new GLTFLoader();
		loader.setMeshoptDecoder(MeshoptDecoder);
		return loader.parseAsync(await response.arrayBuffer(), '');
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
		const key =
			JSON.stringify(extras.vmat?.Name ?? 'default') +
			JSON.stringify(extras.tint ?? []) +
			(extras.paint ? JSON.stringify(extras.paint) : '') +
			(extras.glove ? JSON.stringify(extras.glove) : '');
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

	get hasViewmodel(): boolean {
		return Boolean(this.manifest.viewmodel?.animations.length);
	}

	loadViewmodel(): Promise<ViewmodelAnimations> {
		if (!this.viewmodelClips) {
			const files = this.manifest.viewmodel?.animations ?? [];
			this.viewmodelClips = Promise.all(
				files.map(async (file) => {
					const response = await fetch(`${BASE}/${file}?v=${this.version}`, {
						signal: this.abort.signal
					});
					if (!response.ok) return null;
					const loader = new GLTFLoader();
					loader.setMeshoptDecoder(MeshoptDecoder);
					const gltf = await loader.parseAsync(await response.arrayBuffer(), '');
					return gltf;
				})
			)
				.then((files) => {
					const nodes = this.nodeNames('CT');
					const clips = new Map<string, THREE.AnimationClip>();
					const rigs = new Map<string, THREE.Object3D>();
					for (const gltf of files) {
						if (!gltf) continue;
						for (const clip of gltf.animations)
							clips.set(
								clip.name,
								new THREE.AnimationClip(
									clip.name,
									clip.duration,
									clip.tracks.filter(
										(track) => nodes.has(boneOf(track)) || boneOf(track).includes('@')
									)
								)
							);
						gltf.scene.traverse((object) => {
							if (!object.name.startsWith('rig@')) return;
							const name = object.name.slice(4);
							const root = object.getObjectByName(`${name}@weapon`);
							if (root && !rigs.has(name)) rigs.set(name, root);
						});
					}
					return { clips, rigs };
				})
				.catch(() => ({ clips: new Map(), rigs: new Map() }));
		}
		return this.viewmodelClips;
	}

	createModel(side: Side, agent?: string): { root: THREE.Object3D; meshes: THREE.SkinnedMesh[] } {
		return this.instantiate(this.template(side, agent));
	}

	get info() {
		return {
			skins: this.skinsVersion,
			gloveModels: Object.keys(this.skins?.gloves ?? {}).length,
			glovePaints: Object.values(this.skins?.paints ?? {}).filter((paint) => paint.glove).length,
			paints: Object.keys(this.skins?.paints ?? {}).length
		};
	}

	hasGloves(skin: ReplaySkin | undefined): skin is ReplaySkin {
		return Boolean(skin && this.skins?.gloves?.[skin.item] && this.skins.paints[skin.paint]?.glove);
	}

	loadGloves(skin: ReplaySkin): Promise<{ template: Template; extras: GloveExtras } | null> {
		const file = this.skins?.gloves?.[skin.item]?.model;
		const paint = this.skins?.paints[skin.paint];
		if (!file || !paint?.glove) return Promise.resolve(null);
		let promise = this.gloves.get(file);
		if (!promise) {
			promise = this.fetchGltf(`${SKINS_BASE}/${file}?v=${this.skinsVersion}`)
				.then((gltf) => makeTemplate(gltf.scene))
				.catch(() => null);
			this.gloves.set(file, promise);
		}
		return promise.then((template) =>
			template ? { template, extras: gloveExtras(skin, paint) } : null
		);
	}

	instantiate(template: Template): { root: THREE.Object3D; meshes: THREE.SkinnedMesh[] } {
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

	weapon(key: string, skin?: ReplaySkin | null): Promise<LoadedWeapon | null> {
		const paint = skin ? this.skins?.paints[skin.paint] : undefined;
		const base = paint ? this.skins?.weapons[skinWeaponKey(key, paint.legacy)] : undefined;
		const id = paint && base && skin ? `${key}|${skin.paint}|${skin.wear}` : key;
		let promise = this.weapons.get(id);
		if (!promise) {
			promise =
				paint && base && skin ? this.paintedWeapon(key, skin, paint, base) : this.plainWeapon(key);
			this.weapons.set(id, promise);
		}
		return promise;
	}

	private async plainWeapon(key: string): Promise<LoadedWeapon | null> {
		const entry = this.manifest.weapons[key];
		if (!entry) return null;
		return this.loadWeapon(`${BASE}/${entry.model}?v=${this.version}`, entry).catch(() => null);
	}

	private async paintedWeapon(
		key: string,
		skin: ReplaySkin,
		paint: NonNullable<SkinsPackManifest['paints'][string]>,
		base: NonNullable<SkinsPackManifest['weapons'][string]>
	): Promise<LoadedWeapon | null> {
		const loaded =
			base.model && base.translation && base.rotation
				? await this.loadWeapon(`${SKINS_BASE}/${base.model}?v=${this.skinsVersion}`, {
						translation: base.translation,
						rotation: base.rotation
					}).catch(() => null)
				: await this.plainWeapon(key);
		if (!loaded) return this.plainWeapon(key);
		const scene = cloneSkinned(loaded.scene);
		const extras = paintExtras(skin, paint, base);
		scene.traverse((object) => {
			const mesh = object as THREE.Mesh;
			if (!mesh.isMesh) return;
			const own = mesh.userData.extras as MaterialExtras | undefined;
			if (own?.vmat && !own.vmat.Name.includes('sticker'))
				mesh.userData.extras = { ...own, paint: extras };
		});
		return { scene, offset: loaded.offset };
	}

	private async loadWeapon(
		url: string,
		bone: { translation: number[]; rotation: number[] }
	): Promise<LoadedWeapon> {
		const gltf = await this.fetchGltf(url);
		gltf.scene.traverse((object) => {
			const mesh = object as THREE.Mesh;
			if (!mesh.isMesh) return;
			const extras = (mesh.material as THREE.Material).userData as MaterialExtras;
			mesh.userData.extras = extras;
			mesh.frustumCulled = false;
			if (extras.vmat?.Name.includes('/sticker_gaps')) mesh.visible = false;
		});
		const offset = new THREE.Matrix4()
			.compose(
				new THREE.Vector3().fromArray(bone.translation),
				new THREE.Quaternion().fromArray(bone.rotation),
				new THREE.Vector3(1, 1, 1)
			)
			.invert();
		return { scene: gltf.scene, offset };
	}

	promote(extras: MaterialExtras) {
		const paths = new Set(
			[
				...Object.values(extras.vmat?.TextureParams ?? {}),
				...Object.values(extras.paint?.textures ?? {}),
				...Object.values(extras.glove?.textures ?? {}).flat()
			].filter((path): path is string => typeof path === 'string')
		);
		const urgent = this.queue.filter((job) => paths.has(job.path));
		if (!urgent.length) return;
		this.queue = [...urgent, ...this.queue.filter((job) => !paths.has(job.path))];
	}

	private requestTexture(path: string, srgb: boolean, target: THREE.IUniform) {
		const own = this.manifest.textures[path];
		const ref = own ?? this.skins?.textures[path];
		if (!ref || !supportsFormat(this.support, ref.format)) return;
		const name = this.quality === 'low' && ref.low ? ref.low.file : ref.file;
		const file = own
			? `${BASE}/${name}?v=${this.version}`
			: `${SKINS_BASE}/${name}?v=${this.skinsVersion}`;
		const key = `${file}|${srgb}`;
		let job = this.jobs.get(key);
		if (!job) {
			job = { path, file, srgb, targets: [] };
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
			fetchPackTexture(job.file, this.abort.signal)
				.then((packed) => {
					if (this.abort.signal.aborted) return;
					const texture = createTexture(packed, {
						srgb: job.srgb,
						anisotropy: Math.min(8, this.support.anisotropy),
						maxSize: this.quality === 'medium' ? 512 : undefined
					});
					this.uploader.add(
						texture,
						() => {
							job.texture = texture;
							for (const target of job.targets) target.value = texture;
							this.onChange?.();
						},
						() => this.abort.signal.aborted
					);
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

	private hiddenHands = new Set<THREE.BufferGeometry>();
	private gloveState = 'none';

	get info() {
		return { gloves: this.gloveState, weapon: this.weaponKey, loading: this.weaponLoading };
	}
	private disposed = false;

	constructor(
		pack: PlayerPack,
		side: Side,
		color: number,
		agent?: string,
		gloves?: ReplaySkin,
		onChange?: () => void
	) {
		this.pack = pack;
		this.side = side;
		const { root, meshes } = pack.createModel(side, agent);
		this.model = root;
		this.meshes = meshes.filter((mesh) => {
			const firstPerson = isFirstPerson(mesh);
			if (firstPerson) mesh.visible = false;
			return !firstPerson;
		});
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
		for (const mesh of this.meshes) {
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
		this.gloveState = gloves ? (pack.hasGloves(gloves) ? 'loading' : 'not in pack') : 'none';
		if (pack.hasGloves(gloves))
			void pack.loadGloves(gloves).then((loaded) => {
				this.gloveState = loaded ? 'loaded' : 'failed';
				if (!loaded || this.disposed) return;
				const { added, hidden } = attachGloves(
					pack,
					this.model,
					loaded.template,
					loaded.extras,
					false
				);
				this.gloveState = `attached ${added.length}, hid ${hidden.length}`;
				for (const mesh of hidden) this.hiddenHands.add(mesh.geometry);
				for (const mesh of added) {
					this.meshes.push(mesh);
					this.applyMaterial(mesh);
				}
				onChange?.();
			});
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

	private setWeapon(key: string | null, skin: ReplaySkin | null = null) {
		const id = key && skin ? `${key}|${skin.paint}|${skin.wear}` : key;
		if (id === this.weaponKey && this.weaponLoading === null) return;
		if (id === this.weaponLoading) return;
		this.weaponKey = id;
		this.weaponSlot.clear();
		if (!key || !id) return;
		this.weaponLoading = id;
		void this.pack.weapon(key, skin).then((template) => {
			if (this.weaponLoading !== id) return;
			this.weaponLoading = null;
			if (!template || this.weaponKey !== id) return;
			const weapon = cloneSkinned(template.scene);
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
		for (const mesh of this.ghosts)
			mesh.visible = ghost && player.alive && !this.hiddenHands.has(mesh.geometry);

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
			this.setWeapon(weaponModelKey(key, player.side), skinAt(replay, player.index, tick, key));
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
		this.disposed = true;
		this.mixer.stopAllAction();
		this.ghostMaterial.dispose();
	}
}

export class PlayerModels {
	readonly root = new THREE.Group();
	readonly viewmodel: Viewmodel | null;
	private pack: PlayerPack;
	private models: PlayerModel[] = [];
	private props: { root: THREE.Group; slot: THREE.Group; key: string | null }[] = [];
	private shading: WorldShading | null = null;
	private players: { side: Side; agent?: string; gloves?: ReplaySkin }[] = [];
	private colors: Record<Side, number> = { CT: 0xffffff, T: 0xffffff };
	onChange: (() => void) | null = null;

	constructor(pack: PlayerPack) {
		this.pack = pack;
		this.viewmodel = pack.hasViewmodel ? new Viewmodel(pack) : null;
	}

	setShading(shading: WorldShading | null) {
		this.shading = shading;
		this.pack.setShading(shading);
		for (const model of this.models) model.setShading(shading);
		this.viewmodel?.setShading();
	}

	updateViewmodel(
		replay: RoundReplay,
		tick: number,
		player: PlayerState | null,
		camera: THREE.PerspectiveCamera,
		view: PovPose | null = null
	): Viewmodel | null {
		if (!this.active || !this.viewmodel) return null;
		return this.viewmodel.update(replay, tick, player, camera, view) ? this.viewmodel : null;
	}

	get active(): boolean {
		return this.shading !== null;
	}

	get info() {
		return {
			active: this.active,
			...this.pack.info,
			models: this.models.map((model) => model.info)
		};
	}

	setPlayers(
		players: { side: Side; agent?: string; gloves?: ReplaySkin }[],
		colors: Record<Side, number>
	) {
		for (const model of this.models) {
			this.root.remove(model.root);
			model.dispose();
		}
		const current = players;
		this.players = players;
		this.colors = colors;
		this.models = players.map(({ side, agent, gloves }, i) => {
			if (agent && this.pack.hasAgent(agent))
				void this.pack.loadAgent(agent).then((template) => {
					if (template && this.players === current) this.rebuild(i);
				});
			return this.build(side, agent, gloves);
		});
	}

	private build(side: Side, agent?: string, gloves?: ReplaySkin): PlayerModel {
		const model = new PlayerModel(this.pack, side, this.colors[side], agent, gloves, () =>
			this.onChange?.()
		);
		model.setShading(this.shading);
		this.root.add(model.root);
		return model;
	}

	private rebuild(index: number) {
		const old = this.models[index];
		const player = this.players[index];
		if (!old || !player) return;
		this.root.remove(old.root);
		old.dispose();
		this.models[index] = this.build(player.side, player.agent, player.gloves);
		this.onChange?.();
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

	updateProps(replay: RoundReplay, tick: number) {
		if (!this.active) return;
		const seconds = tick / replay.meta.tickRate;
		let used = 0;
		for (const grenade of replay.meta.grenades) {
			const position = grenadePosition(grenade.path, tick);
			if (!position) continue;
			const prop = this.prop(used++, GRENADE_MODELS[grenade.type]);
			if (!prop) continue;
			prop.position.set(position.x, position.y, position.z);
			prop.rotation.set(seconds * 9, seconds * 5, seconds * 3);
		}
		const bomb = bombState(replay, tick);
		if (bomb && bomb.kind !== 'exploded') {
			const prop = this.prop(used++, 'c4');
			if (prop) {
				prop.position.set(bomb.x, bomb.y, bomb.z + 1);
				prop.rotation.set(0, Math.PI / 2, (bomb.tick % 360) * DEG);
			}
		}
		for (let i = used; i < this.props.length; i++) this.props[i]!.root.visible = false;
	}

	private prop(index: number, key: string): THREE.Group | null {
		let prop = this.props[index];
		if (!prop) {
			prop = { root: new THREE.Group(), slot: new THREE.Group(), key: null };
			prop.slot.matrixAutoUpdate = false;
			prop.slot.matrix.copy(GLTF_TO_SOURCE);
			prop.root.add(prop.slot);
			this.root.add(prop.root);
			this.props.push(prop);
		}
		prop.root.visible = true;
		if (prop.key !== key) {
			prop.key = key;
			prop.slot.clear();
			const target = prop;
			void this.pack.weapon(key).then((loaded) => {
				if (!loaded || target.key !== key) return;
				const model = cloneSkinned(loaded.scene);
				model.traverse((object) => {
					const mesh = object as THREE.Mesh;
					if (!mesh.isMesh) return;
					const material = this.pack.material((mesh.userData.extras ?? {}) as MaterialExtras);
					if (material) mesh.material = material;
				});
				target.slot.add(model);
			});
		}
		return prop.root;
	}

	dispose() {
		for (const model of this.models) model.dispose();
		this.viewmodel?.dispose();
		this.pack.dispose();
	}
}

const GRENADE_MODELS: Record<GrenadeType, string> = {
	smoke: 'smokegrenade',
	flash: 'flashbang',
	he: 'hegrenade',
	molotov: 'molotov',
	decoy: 'decoy'
};

function makeTemplate(scene: THREE.Object3D): Template {
	const materials = new Map<THREE.Mesh, MaterialExtras>();
	scene.traverse((object) => {
		const mesh = object as THREE.Mesh;
		if (!mesh.isMesh) return;
		materials.set(mesh, (mesh.material as THREE.Material).userData as MaterialExtras);
		mesh.frustumCulled = false;
	});
	return { scene, materials };
}

const HAND_MATERIAL = /\/glove_|bare_arm/;

export function isHandMesh(mesh: THREE.Object3D, firstPerson: boolean): boolean {
	const name = (
		(mesh.userData.extras as MaterialExtras | undefined)?.vmat?.Name ?? ''
	).toLowerCase();
	if (isFirstPerson(mesh) !== firstPerson) return false;
	return firstPerson ? HAND_MATERIAL.test(name) : name.includes('/glove_');
}

export function attachGloves(
	pack: PlayerPack,
	model: THREE.Object3D,
	template: Template,
	extras: GloveExtras,
	firstPerson: boolean
): { added: THREE.SkinnedMesh[]; hidden: THREE.Mesh[] } {
	const own: THREE.SkinnedMesh[] = [];
	model.traverse((object) => {
		const mesh = object as THREE.SkinnedMesh;
		if (mesh.isSkinnedMesh && !mesh.userData.gloves) own.push(mesh);
	});
	const reference = own.find((mesh) => isFirstPerson(mesh) === firstPerson) ?? own[0];
	if (!reference?.parent) return { added: [], hidden: [] };
	const bones = new Map<string, THREE.Bone>();
	model.traverse((object) => {
		if ((object as THREE.Bone).isBone) bones.set(object.name, object as THREE.Bone);
	});
	const { root } = pack.instantiate(template);
	const added: THREE.SkinnedMesh[] = [];
	const candidates: THREE.SkinnedMesh[] = [];
	root.traverse((object) => {
		const mesh = object as THREE.SkinnedMesh;
		if (mesh.isSkinnedMesh && isFirstPerson(mesh) === firstPerson) candidates.push(mesh);
	});
	const extra = new Map<THREE.Bone, THREE.Bone>();
	const resolve = (bone: THREE.Bone): THREE.Bone | null => {
		const found = bones.get(bone.name) ?? extra.get(bone);
		if (found) return found;
		const parent = (bone.parent as THREE.Bone | null)?.isBone
			? resolve(bone.parent as THREE.Bone)
			: null;
		if (!parent) return null;
		const copy = new THREE.Bone();
		copy.name = bone.name;
		copy.position.copy(bone.position);
		copy.quaternion.copy(bone.quaternion);
		copy.scale.copy(bone.scale);
		parent.add(copy);
		extra.set(bone, copy);
		return copy;
	};
	for (const mesh of candidates) {
		const mapped = mesh.skeleton.bones.map(resolve);
		if (mapped.some((bone) => !bone)) continue;
		mesh.bind(
			new THREE.Skeleton(mapped as THREE.Bone[], mesh.skeleton.boneInverses),
			reference.bindMatrix
		);
		const ownExtras = (mesh.userData.extras ?? {}) as MaterialExtras;
		if (ownExtras.vmat?.Name.toLowerCase().includes('glove'))
			mesh.userData.extras = { ...ownExtras, glove: extras };
		mesh.userData.gloves = true;
		mesh.frustumCulled = false;
		mesh.visible = true;
		reference.parent.add(mesh);
		added.push(mesh);
	}
	if (!added.length) return { added, hidden: [] };
	const hidden = own.filter((mesh) => isHandMesh(mesh, firstPerson));
	for (const mesh of hidden) mesh.visible = false;
	return { added, hidden };
}

function patternTransform(scale: number, degrees: number, offset: number[], flip: boolean) {
	const angle = ((flip ? -degrees : degrees) * Math.PI) / 180;
	const c = Math.cos(angle);
	const sn = Math.sin(angle);
	const half = 0.5 / (scale !== 0 ? scale : 1);
	const c2 = Math.cos(-angle);
	const s2 = Math.sin(-angle);
	const a = half * c2 - half * s2;
	const b = a * s2 + half * c2;
	return {
		x0: [c * scale, -sn * scale, 0, scale * c * a + scale * -sn * b + ((offset[0] ?? 0) - 0.5)],
		x1: [sn * scale, c * scale, 0, scale * sn * a + scale * c * b + ((offset[1] ?? 0) - 0.5)]
	} as { x0: [number, number, number, number]; x1: [number, number, number, number] };
}

function gloveExtras(skin: ReplaySkin, paint: SkinsPackManifest['paints'][string]): GloveExtras {
	const { ints, floats, vectors, textures } = paint;
	const layer = (name: string, fallback: number) =>
		[1, 2, 3, 4].map((i) => floats[`${name}${i}`] ?? fallback) as [number, number, number, number];
	const flip = ints.g_bFlipFixup === 1;
	const pattern = patternTransform(
		floats.g_fPatternTexCoordScale ?? 1,
		floats.g_fPatternTexCoordRotation ?? 0,
		vectors.g_fPatternTexCoordOffset ?? [0, 0],
		flip
	);
	const palette = vectors.g_vPatternPaletteIndices ?? [1, 2, 3, 4];
	return {
		textures: {
			mask: textures.g_tLayerMask,
			surface: textures.g_tSurface,
			normal: textures.g_tNormal,
			pattern: textures.g_tPattern,
			detail: [1, 2, 3, 4].map((i) => textures[`g_tDetail${i}`]),
			detailNormal: [1, 2, 3, 4].map((i) => textures[`g_tDetailNormal${i}`])
		},
		tints: [1, 2, 3, 4, 5, 6, 7, 8].map(
			(i) => vectors[`g_vColorTint${i}`]?.slice(0, 3) ?? [1, 1, 1]
		),
		palette: [palette[0] ?? 1, palette[1] ?? 2, palette[2] ?? 3, palette[3] ?? 4],
		patternX0: pattern.x0,
		patternX1: pattern.x1,
		detailScale: layer('g_fDetailScale', 1),
		blackPoint: layer('g_fDetailBlackPoint', 0),
		roughContrast: layer('g_fDetailRoughnessContrast', 0),
		roughBrightness: layer('g_fDetailRoughnessBrightness', 1),
		metalness: layer('g_fDetailMetalness', 0),
		normalContrast: layer('g_fDetailNormalContrast', 1),
		curvature: layer('g_fCurvaturePower', 1),
		params: [
			floats.g_fColorMaskBlur ?? 1,
			floats.g_fPaintThickness ?? 0,
			floats.g_fPatternDetailInfluence ?? 0,
			Math.max(0, Math.min(1, skin.wear))
		],
		params2: [
			flip ? -1 : 1,
			ints.F_PATTERN === 1 ? 1 : 0,
			ints.g_nPatternMode ?? 0,
			(ints.g_nPatternReplaceIndex ?? 1) - 1
		],
		patternProps: [
			floats.g_fPatternRoughnessBrightness ?? 1,
			floats.g_fPatternMetalness ?? 0,
			floats.g_fPaintDurability ?? 1,
			0
		]
	};
}

function paintExtras(
	skin: ReplaySkin,
	paint: SkinsPackManifest['paints'][string],
	base: SkinsPackManifest['weapons'][string]
): PaintExtras {
	const { ints, floats, vectors, textures } = paint;
	const offset = (name: string) => [vectors[name]?.[0] ?? 0, vectors[name]?.[1] ?? 0];
	const sizeScale = ints.g_bIgnoreWeaponSizeScale === 1 ? 1 : base.uvScale;
	const customNormal = ints.F_OVERRIDE_NORMAL === 1 || ints.g_bUseNormalMap === 1;
	const ownMasks = ints.g_bOverrideDefaultMasks === 1 ? textures.g_tPaintByNumberMasks : undefined;
	const vector = (name: string, fallback: number[]) => vectors[name] ?? fallback;
	const spray = vector('g_vSprayBiasBlend', [0, 0, 0]);
	return {
		style: paint.style,
		textures: {
			pattern: textures.g_tPattern,
			normal: customNormal ? textures.g_tNormal : undefined,
			wear: textures.g_tWear,
			grunge: textures.g_tGrunge,
			masks: ownMasks ?? base.textures.g_tMasks,
			ao: base.textures.g_tAmbientOcclusion,
			position: base.textures.g_tPosition,
			surface: base.textures.g_tSurface
		},
		colors: [0, 1, 2, 3].map((i) => vectors[`g_vColor${i}`]?.slice(0, 3) ?? [1, 1, 1]),
		durability: vector('g_vPaintDurability', [1, 1, 1, 1]),
		roughnessColors: vector('g_vPaintRoughness', [0.6, 0.6, 0.6, 0.6]),
		metalnessColors: vector('g_vPaintMetalness', [0, 0, 0, 0]),
		albedoLevels: vector('g_vPaintAlbedoLevels', [0, 0, 0, 0]),
		metallicAlbedoLevels: vector('g_vMetallicPaintAlbedoLevels', [0, 0, 0, 0]),
		sprayBias: [spray[1] ?? 0, spray[2] ?? 0],
		pattern: [
			(floats.g_flPatternTexCoordScale ?? 1) * sizeScale,
			floats.g_flPatternTexCoordRotation ?? 0,
			...offset('g_vPatternTexCoordOffset')
		] as PaintExtras['pattern'],
		wearTransform: [
			floats.g_flWearTexCoordScale ?? 1,
			floats.g_flWearTexCoordRotation ?? 0,
			...offset('g_vWearTexCoordOffset')
		] as PaintExtras['wearTransform'],
		grunge: [
			floats.g_flGrungeTexCoordScale ?? 1,
			floats.g_flGrungeTexCoordRotation ?? 0,
			...offset('g_vGrungeTexCoordOffset')
		] as PaintExtras['grunge'],
		wear: Math.max(0, Math.min(1, skin.wear)),
		softness: floats.g_fWearSoftness ?? 0,
		brightness: floats.g_flColorBrightness ?? 1,
		roughness: floats.g_flPaintRoughness ?? 0.6,
		metalness: floats.g_flPaintMetalness ?? 0,
		roughnessPerColor: ints.g_bRoughnessPerColor === 1,
		colorAdjustment: ints.g_nColorAdjustmentMode ?? 0
	};
}

export function skinAt(
	replay: RoundReplay,
	player: number,
	tick: number,
	key: string | null
): ReplaySkin | null {
	const changes = replay.meta.skinChanges;
	const skins = replay.meta.skins;
	if (!changes || !skins || !key) return null;
	let index = -1;
	for (let i = 0; i < changes.length; i += 3) {
		if (changes[i]! > tick) break;
		if (changes[i + 1] === player) index = changes[i + 2]!;
	}
	const skin = index >= 0 ? skins[index] : undefined;
	return skin && itemWeaponKey(skin.item) === key ? skin : null;
}
