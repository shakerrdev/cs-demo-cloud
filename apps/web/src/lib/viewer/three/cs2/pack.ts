import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { MapPackManifest, PackTextureRef, PackWorld } from '@cs-demo-cloud/replay';
import { createCs2Material, type MaterialExtras } from './material.ts';
import { PostProcess, createSkyMesh } from './post.ts';
import {
	createTexture,
	fetchPackTexture,
	supportsFormat,
	textureSupport,
	type TextureOptions,
	type TextureSupport
} from './textures.ts';
import {
	anglesToMatrix,
	createWorldShading,
	fogUniforms,
	type WorldShadingSetup
} from './world.ts';

const GLTF_TO_SOURCE = new THREE.Matrix4().set(
	0,
	0,
	1 / 0.0254,
	0,
	1 / 0.0254,
	0,
	0,
	0,
	0,
	1 / 0.0254,
	0,
	0,
	0,
	0,
	0,
	1
);

const CONCURRENT_DOWNLOADS = 6;

export interface PackProgress {
	textures: number;
	texturesLoaded: number;
	ready: boolean;
}

interface LoadedWorld {
	world: PackWorld;
	group: THREE.Group;
	setup: WorldShadingSetup;
}

interface TextureJob {
	key: string;
	ref: PackTextureRef;
	priority: number;
	options: TextureOptions;
	targets: THREE.IUniform[];
	onLoad?: (texture: THREE.Texture) => void;
}

export class UnsupportedPackError extends Error {}

export class MapPack {
	readonly manifest: MapPackManifest;
	readonly main: THREE.Group;
	readonly skyboxScene: THREE.Scene | null;
	readonly sky: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
	readonly skyboxCamera = new THREE.PerspectiveCamera(50, 1, 0.5, 200000);
	readonly post = new PostProcess();
	readonly progress: PackProgress = { textures: 0, texturesLoaded: 0, ready: false };
	onChange: (() => void) | null = null;

	private base: string;
	private version: string;
	private support: TextureSupport;
	private shared: Record<string, THREE.IUniform>;
	private worlds: LoadedWorld[] = [];
	private jobs = new Map<string, TextureJob>();
	private queue: TextureJob[] = [];
	private active = 0;
	private textures = new Set<THREE.Texture>();
	private materials = new Set<THREE.Material>();
	private abort = new AbortController();
	private skyboxWorld: LoadedWorld | null = null;

	private constructor(
		base: string,
		version: string,
		manifest: MapPackManifest,
		support: TextureSupport
	) {
		this.base = base;
		this.version = version;
		this.manifest = manifest;
		this.support = support;
		this.main = new THREE.Group();
		this.main.name = `cs2:${manifest.map}`;
		this.sky = createSkyMesh();
		const skybox = manifest.worlds.some((world) => world.kind === 'skybox');
		this.skyboxScene = skybox ? new THREE.Scene() : null;
		this.skyboxCamera.up.set(0, 0, 1);
		this.shared = {
			uCameraWorld: { value: new THREE.Vector3() },
			uCutZ: { value: 1e9 },
			uTime: { value: 0 },
			...fogUniforms(manifest, 8)
		};
		(this.skyboxScene ?? this.main).add(this.sky);
	}

	static async load(
		renderer: THREE.WebGLRenderer,
		map: string,
		version: string,
		onProgress?: (progress: PackProgress) => void
	): Promise<MapPack> {
		const base = `/maps/3d/${map}`;
		const response = await fetch(`${base}/map.json?v=${version}`);
		if (!response.ok) throw new Error(`The 3D map could not be loaded (${response.status})`);
		const manifest = (await response.json()) as MapPackManifest;
		const support = textureSupport(renderer);
		const missing = (['bc1', 'bc7', 'bc6h'] as const).filter(
			(format) => !supportsFormat(support, format)
		);
		if (missing.length)
			throw new UnsupportedPackError(
				`This browser or GPU can’t show game textures (${missing.join(', ')} not supported)`
			);

		const pack = new MapPack(base, version, manifest, support);
		await pack.build(onProgress);
		return pack;
	}

	private url(file: string): string {
		return `${this.base}/${file}?v=${this.version}`;
	}

	private async build(onProgress?: (progress: PackProgress) => void) {
		const manifest = this.manifest;
		this.requestSky();
		this.requestPostProcess();

		for (const world of manifest.worlds) {
			const setup = createWorldShading(manifest, world, this.shared);
			this.requestWorldTextures(world, setup);
			const group = await this.loadModel(world, setup);
			const loaded = { world, group, setup };
			this.worlds.push(loaded);
			if (world.kind === 'skybox') {
				if (!this.skyboxWorld) this.skyboxWorld = loaded;
				this.skyboxScene?.add(group);
			} else {
				this.main.add(group);
			}
		}

		const exposure = manifest.exposure ? (manifest.exposure.min + manifest.exposure.max) / 2 : 1;
		this.post.setTonemap(manifest.postProcess?.tonemap ?? null, exposure);
		this.post.setBloom(manifest.postProcess?.bloom ?? null);

		const report = () => onProgress?.(this.progress);
		this.onTexture = () => {
			report();
			this.onChange?.();
		};
		report();
		this.pump();
	}

	private onTexture: () => void = () => {};

	private async loadModel(world: PackWorld, setup: WorldShadingSetup): Promise<THREE.Group> {
		const response = await fetch(this.url(world.model), { signal: this.abort.signal });
		if (!response.ok) throw new Error(`${world.model} answered ${response.status}`);
		const loader = new GLTFLoader();
		loader.setMeshoptDecoder(MeshoptDecoder);
		const gltf = await loader.parseAsync(await response.arrayBuffer(), '');

		const replaced = new Map<THREE.Material, THREE.Material>();
		gltf.scene.traverse((object) => {
			const mesh = object as THREE.Mesh;
			if (!mesh.isMesh) return;
			const original = mesh.material as THREE.Material;
			let material = replaced.get(original);
			if (!material) {
				material = createCs2Material(
					original.userData as MaterialExtras,
					setup.shading,
					(path, srgb, target) => this.requestTexture(path, srgb, target)
				);
				replaced.set(original, material);
				this.materials.add(material);
				original.dispose();
			}
			mesh.material = material;
			mesh.matrixAutoUpdate = false;
			mesh.updateMatrix();
		});

		const group = new THREE.Group();
		group.name = world.id;
		group.matrixAutoUpdate = false;
		group.matrix.copy(GLTF_TO_SOURCE);
		group.add(gltf.scene);
		group.updateMatrixWorld(true);
		return group;
	}

	private requestTexture(path: string, srgb: boolean, target: THREE.IUniform, priority = 3) {
		const ref = this.manifest.textures[path];
		if (!ref || !supportsFormat(this.support, ref.format)) return;
		this.enqueue(
			`${path}|${srgb}`,
			ref,
			priority,
			{
				srgb,
				anisotropy: Math.min(8, this.support.anisotropy)
			},
			target
		);
	}

	private enqueue(
		key: string,
		ref: PackTextureRef,
		priority: number,
		options: TextureOptions,
		target: THREE.IUniform | null,
		onLoad?: (texture: THREE.Texture) => void
	) {
		let job = this.jobs.get(key);
		if (!job) {
			job = { key, ref, priority, options, targets: [], onLoad };
			this.jobs.set(key, job);
			this.queue.push(job);
			this.progress.textures++;
		}
		if (target) job.targets.push(target);
	}

	private requestWorldTextures(world: PackWorld, setup: WorldShadingSetup) {
		const textures = this.manifest.textures;
		const lightmaps = world.lightmaps;
		if (lightmaps) {
			const add = (
				path: string | null,
				target: THREE.IUniform,
				filter: TextureOptions['filter']
			) => {
				const ref = path ? textures[path] : undefined;
				if (ref && supportsFormat(this.support, ref.format))
					this.enqueue(`${path}|lightmap`, ref, 0, { clamp: true, filter }, target);
			};
			add(lightmaps.irradiance, setup.lightmapUniforms.irradiance, 'trilinear');
			add(
				lightmaps.directional ?? lightmaps.directionalSh?.[0] ?? null,
				setup.lightmapUniforms.directional,
				'trilinear'
			);
			add(lightmaps.shadows, setup.lightmapUniforms.shadows, 'linear');
		}
		const envMaps = world.envMaps;
		const envRef = envMaps ? textures[envMaps.texture] : undefined;
		if (
			envMaps &&
			envRef &&
			supportsFormat(this.support, envRef.format) &&
			envRef.depth * envRef.faces <= this.support.maxArrayLayers
		)
			this.enqueue(
				`${envMaps.texture}|envmap`,
				envRef,
				1,
				{ clamp: true, filter: 'trilinear', array: true },
				setup.envUniforms.texture,
				(texture) => {
					setup.envUniforms.mips.value = Math.max(0, texture.mipmaps.length - 1);
				}
			);
		const probes = world.probes;
		if (probes) {
			const irradiance = textures[probes.irradiance];
			if (
				irradiance &&
				supportsFormat(this.support, irradiance.format) &&
				irradiance.depth <= this.support.maxArrayLayers
			)
				this.enqueue(
					`${probes.irradiance}|probes`,
					irradiance,
					1,
					{ clamp: true, filter: 'linear', array: true },
					setup.probeUniforms.irradiance
				);
			const shadows = probes.shadows ? textures[probes.shadows] : undefined;
			if (shadows && supportsFormat(this.support, shadows.format))
				this.enqueue(
					`${probes.shadows}|probes`,
					shadows,
					1,
					{ clamp: true, filter: 'linear', array: true },
					setup.probeUniforms.shadows
				);
		}
	}

	private requestSky() {
		const sky = this.manifest.sky;
		const fog = this.manifest.fog?.cubemap;
		const uniforms = this.sky.material.uniforms;
		if (sky) {
			const ref = this.manifest.textures[sky.texture];
			const bias = 2 ** sky.exposureBias;
			(uniforms.uScale!.value as THREE.Vector3).set(
				sky.tint[0] * bias,
				sky.tint[1] * bias,
				sky.tint[2] * bias
			);
			(uniforms.uRotation!.value as THREE.Matrix3)
				.setFromMatrix4(anglesToMatrix(sky.angles))
				.transpose();
			if (ref && supportsFormat(this.support, ref.format))
				this.enqueue(`${sky.texture}|sky`, ref, 0, { filter: 'trilinear' }, uniforms.uSky!, () => {
					this.sky.visible = true;
				});
		}
		if (fog) {
			const ref = this.manifest.textures[fog.texture];
			if (ref && supportsFormat(this.support, ref.format)) {
				const key = fog.texture === sky?.texture ? `${sky.texture}|sky` : `${fog.texture}|fog`;
				this.enqueue(key, ref, 0, { filter: 'trilinear' }, this.shared.uFogCube!);
			}
		}
	}

	private requestPostProcess() {
		const lut = this.manifest.postProcess?.lut;
		const ref = lut ? this.manifest.textures[lut] : undefined;
		if (lut && ref)
			this.enqueue(`${lut}|lut`, ref, 0, { clamp: true, filter: 'linear' }, null, (texture) =>
				this.post.setLut(texture as THREE.Data3DTexture)
			);
	}

	private pump() {
		this.queue.sort((a, b) => a.priority - b.priority);
		while (this.active < CONCURRENT_DOWNLOADS && this.queue.length) {
			const job = this.queue.shift()!;
			this.active++;
			fetchPackTexture(this.url(job.ref.file), this.abort.signal)
				.then((packed) => {
					if (this.abort.signal.aborted) return;
					const texture = createTexture(packed, job.options);
					this.textures.add(texture);
					for (const target of job.targets) target.value = texture;
					job.onLoad?.(texture);
				})
				.catch((error: Error) => {
					if (!this.abort.signal.aborted)
						console.warn(`Texture ${job.key} failed: ${error.message}`);
				})
				.finally(() => {
					this.active--;
					this.progress.texturesLoaded++;
					if (!this.queue.length && this.active === 0) this.progress.ready = true;
					if (!this.abort.signal.aborted) {
						this.onTexture();
						this.pump();
					}
				});
		}
	}

	update(camera: THREE.PerspectiveCamera, time: number) {
		(this.shared.uCameraWorld!.value as THREE.Vector3).copy(camera.position);
		this.shared.uTime!.value = time;
		const skybox = this.skyboxWorld?.world.skyCamera;
		if (skybox) {
			const cam = this.skyboxCamera;
			cam.position
				.copy(camera.position)
				.divideScalar(skybox.scale)
				.add(new THREE.Vector3(...skybox.origin));
			cam.quaternion.copy(camera.quaternion);
			cam.fov = camera.fov;
			cam.aspect = camera.aspect;
			cam.near = Math.max(0.5, camera.near / skybox.scale);
			cam.far = 200000;
			cam.updateProjectionMatrix();
			cam.updateMatrixWorld(true);
		}
	}

	setCutZ(z: number) {
		this.shared.uCutZ!.value = z;
	}

	dispose() {
		this.abort.abort();
		this.queue = [];
		for (const texture of this.textures) texture.dispose();
		for (const material of this.materials) material.dispose();
		for (const { group, setup } of this.worlds) {
			group.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
			setup.dispose();
		}
		this.sky.geometry.dispose();
		this.sky.material.dispose();
		this.post.dispose();
	}
}
