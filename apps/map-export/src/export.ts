import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';

const gzip = promisify(gzipCallback);
import {
	MAP_PACK_MANIFEST,
	MAP_PACK_VERSION,
	TEXTURE_CLAMP_S,
	TEXTURE_CLAMP_T,
	TEXTURE_VOLUME,
	encodePackTexture,
	type BloomBlendMode,
	type MapPackManifest,
	type PackBloom,
	type PackCubemapFog,
	type PackEnvMaps,
	type PackFog,
	type PackGradientFog,
	type PackLightmaps,
	type PackPostProcess,
	type PackProbes,
	type PackTexture,
	type PackSky,
	type PackSun,
	type PackTextureRef,
	type PackWorld,
	type Vec3,
	type Vec4
} from '@cs-demo-cloud/replay';
import { ZipWriter } from '@cs-demo-cloud/shared/zip';
import {
	className,
	findClass,
	number,
	parseEntities,
	text,
	vec3,
	type Entity
} from './entities.ts';
import { processWorldGltf, repackBuffers, type Gltf } from './gltf.ts';
import { kv3Array, kv3Object, type Kv3Value } from './kv3.ts';
import { gameBuild } from './steam.ts';
import { run, Vrf } from './vrf.ts';
import { parseVtex } from './vtex.ts';
import { Vpk } from './vpk.ts';
import type { Tools } from './tools.ts';

export const EXPORTER_VERSION = '1';

export interface ExportOptions {
	map: string;
	csgo: string;
	outDir: string;
	workDir: string;
	tools: Tools;
	log: (message: string) => void;
	keepWork?: boolean;
	reuseWork?: boolean;
	maxTextureSize?: number;
	mapVpk?: string;
}

interface WorldSource {
	id: string;
	kind: 'world' | 'skybox';
	vpk: Vpk;
	worldPath: string;
}

function srgbToLinear(value: number): number {
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearColor(entity: Entity, key: string, fallback: Vec3): Vec3 {
	return vec3(entity, key, fallback).map((c) => srgbToLinear(c / 255)) as Vec3;
}

function forward(angles: Vec3): Vec3 {
	const pitch = (angles[0] * Math.PI) / 180;
	const yaw = (angles[1] * Math.PI) / 180;
	return [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch)];
}

function enabled(entity: Entity): boolean {
	return text(entity, 'startdisabled') !== 'true' && text(entity, 'startdisabled') !== '1';
}

function params(material: Kv3Value, list: string, value: string): Map<string, Kv3Value> {
	const out = new Map<string, Kv3Value>();
	for (const item of kv3Array(kv3Object(material)?.[list])) {
		const entry = kv3Object(item);
		const name = entry?.m_name;
		if (typeof name === 'string' && entry && value in entry) out.set(name, entry[value]!);
	}
	return out;
}

function resourcePath(value: Kv3Value | undefined): string | null {
	return typeof value === 'string' && value ? value : null;
}

export function limitTextureSize(texture: PackTexture, maxSize: number): PackTexture {
	let skip = 0;
	while (
		skip < texture.mips - 1 &&
		Math.max(texture.width >> skip, texture.height >> skip) > maxSize
	)
		skip++;
	if (skip === 0) return texture;
	return {
		...texture,
		width: Math.max(1, texture.width >> skip),
		height: Math.max(1, texture.height >> skip),
		depth: texture.flags & TEXTURE_VOLUME ? Math.max(1, texture.depth >> skip) : texture.depth,
		mips: texture.mips - skip,
		mipData: texture.mipData.slice(skip)
	};
}

const TEXTURE_CONCURRENCY = 4;

export async function forEachLimit<T>(
	items: T[],
	limit: number,
	task: (item: T) => Promise<unknown>
): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await task(items[next++]!);
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export function lowTextureSize(folder: string): number {
	if (folder === 'textures') return 256;
	if (folder.startsWith('lightmaps/')) return 1024;
	return 0;
}

export class PackBuilder {
	private zip: ZipWriter;
	private names = new Set<string>();
	readonly textures: Record<string, PackTextureRef> = {};
	readonly radianceSh = new Map<string, number[]>();
	private missing = new Set<string>();
	private writes: Promise<void> = Promise.resolve();
	private log: (message: string) => void;
	private maxTextureSize: number;
	resampler:
		((path: string, source: PackTexture, maxSize: number) => Promise<PackTexture | null>) | null =
		null;
	textureCache: string | null = null;
	bytes = 0;

	constructor(path: string, log: (message: string) => void, maxTextureSize = 0) {
		this.zip = new ZipWriter(path);
		this.log = log;
		this.maxTextureSize = maxTextureSize;
	}

	async addFile(name: string, content: Uint8Array, compress: boolean): Promise<string> {
		if (compress) return this.addGzipped(name, new Uint8Array(await gzip(content, { level: 6 })));
		return this.addEntry(name, content, true);
	}

	copyEntry(name: string, data: Uint8Array, compress: boolean): Promise<string> {
		this.names.add(name);
		return this.addEntry(name, data, compress);
	}

	private addGzipped(name: string, data: Uint8Array): Promise<string> {
		return this.addEntry(`${name}.gz`, data, false);
	}

	private async addEntry(entry: string, data: Uint8Array, store: boolean): Promise<string> {
		this.bytes += data.length;
		const write = this.writes.then(() => this.zip.add(entry, data, store));
		this.writes = write.catch(() => {});
		await write;
		return entry;
	}

	private uniqueName(folder: string, path: string): string {
		const stem = basename(path).replace(/\.vtex(_c)?$/, '');
		let name = `${folder}/${stem}.cstx`;
		for (let i = 2; this.names.has(name); i++) name = `${folder}/${stem}_${i}.cstx`;
		this.names.add(name);
		return name;
	}

	async addTexture(
		path: string,
		vpks: Vpk[],
		folder = 'textures',
		maxSize = this.maxTextureSize
	): Promise<PackTextureRef | null> {
		const key = path.replace(/_c$/, '');
		if (this.textures[key]) return this.textures[key]!;
		if (this.missing.has(key)) return null;

		const cached = this.textureCache
			? join(this.textureCache, `${key.replaceAll('/', '__')}.${folder}.${maxSize}`)
			: null;
		if (cached && existsSync(`${cached}.json`)) {
			const saved = JSON.parse(await readFile(`${cached}.json`, 'utf8')) as {
				ref: Omit<PackTextureRef, 'file' | 'low'>;
				low?: Omit<NonNullable<PackTextureRef['low']>, 'file'>;
				radianceSh?: number[];
			};
			const ref: PackTextureRef = {
				...saved.ref,
				file: await this.addGzipped(this.uniqueName(folder, key), await readFile(`${cached}.gz`))
			};
			if (saved.low)
				ref.low = {
					...saved.low,
					file: await this.addGzipped(
						this.uniqueName(folder, `${key.replace(/\.vtex$/, '')}_low`),
						await readFile(`${cached}.low.gz`)
					)
				};
			this.textures[key] = ref;
			if (saved.radianceSh) this.radianceSh.set(key, saved.radianceSh);
			return ref;
		}

		const compiled = `${key}_c`;
		const vpk = vpks.find((candidate) => candidate.has(compiled));
		if (!vpk) {
			this.missing.add(key);
			this.log(`  missing texture ${key}`);
			return null;
		}
		const parsed = parseVtex(await vpk.read(compiled));
		if (!parsed.texture) {
			this.missing.add(key);
			this.log(`  skipped ${key} (${parsed.unsupported})`);
			return null;
		}
		let texture =
			folder === 'textures' && maxSize > 0
				? limitTextureSize(parsed.texture, maxSize)
				: parsed.texture;
		if (
			this.resampler &&
			folder === 'textures' &&
			maxSize > 0 &&
			Math.max(texture.width, texture.height) > maxSize
		) {
			const resampled = await this.resampler(key, parsed.texture, maxSize).catch(() => null);
			if (resampled) texture = resampled;
		}

		const full = new Uint8Array(await gzip(encodePackTexture(texture), { level: 6 }));
		const file = await this.addGzipped(this.uniqueName(folder, key), full);
		const ref: PackTextureRef = {
			file,
			format: texture.format,
			width: texture.width,
			height: texture.height,
			depth: texture.depth,
			faces: texture.faces,
			bytes: texture.mipData.reduce((sum, mip) => sum + mip.length, 0)
		};
		const lowSize = lowTextureSize(folder);
		if (
			lowSize &&
			texture.faces === 1 &&
			texture.depth === 1 &&
			Math.max(texture.width, texture.height) > lowSize
		) {
			const low = limitTextureSize(texture, lowSize);
			const lowData = new Uint8Array(await gzip(encodePackTexture(low), { level: 6 }));
			if (cached) await writeFile(`${cached}.low.gz`, lowData);
			ref.low = {
				file: await this.addGzipped(
					this.uniqueName(folder, `${key.replace(/\.vtex$/, '')}_low`),
					lowData
				),
				width: low.width,
				height: low.height,
				bytes: low.mipData.reduce((sum, mip) => sum + mip.length, 0)
			};
		}
		this.textures[key] = ref;
		if (parsed.info.radianceSh) this.radianceSh.set(key, parsed.info.radianceSh);
		if (cached) {
			await writeFile(`${cached}.gz`, full);
			const { file: _file, low, ...rest } = ref;
			await writeFile(
				`${cached}.json`,
				JSON.stringify({
					ref: rest,
					low: low ? { width: low.width, height: low.height, bytes: low.bytes } : undefined,
					radianceSh: parsed.info.radianceSh
				})
			);
		}
		return ref;
	}

	async addRawTexture(key: string, folder: string, texture: PackTexture): Promise<PackTextureRef> {
		const file = await this.addFile(
			this.uniqueName(folder, key.replace(/[#:]/g, '_')),
			encodePackTexture(texture),
			true
		);
		const ref: PackTextureRef = {
			file,
			format: texture.format,
			width: texture.width,
			height: texture.height,
			depth: texture.depth,
			faces: texture.faces,
			bytes: texture.mipData.reduce((sum, mip) => sum + mip.length, 0)
		};
		this.textures[key] = ref;
		return ref;
	}

	close(): Promise<void> {
		return this.zip.close();
	}
}

async function readEntities(vrf: Vrf, vpk: Vpk, worldFolder: string, workDir: string) {
	const out = join(workDir, 'entities');
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	await vrf.decompile(vpk.path, `${worldFolder}/entities/`, out + sep, 'vents_c');
	const entities: Entity[] = [];
	const walk = async (folder: string) => {
		if (!existsSync(folder)) return;
		for (const entry of await readdir(folder, { withFileTypes: true })) {
			const full = join(folder, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.name.endsWith('.vents'))
				entities.push(...parseEntities(await readFile(full, 'utf8')));
		}
	};
	await walk(out);
	return entities;
}

function sunFrom(entities: Entity[]): PackSun | null {
	const light = entities.find((e) => className(e) === 'light_environment' && enabled(e));
	if (!light) return null;
	const direction = forward(vec3(light, 'angles', [0, 0, 0]));
	const brightness = number(light, 'brightness', 1) * number(light, 'brightnessscale', 1);
	return {
		toSun: direction.map((c) => -c) as Vec3,
		color: linearColor(light, 'color', [255, 255, 255]).map((c) => c * brightness) as Vec3,
		shadowChannel: number(light, 'bakedshadowindex', -1),
		specular: number(light, 'renderspecular', 1) === 1
	};
}

const PROBE_CLASSES = new Set(['env_combined_light_probe_volume', 'env_light_probe_volume']);
const ENV_MAP_CLASSES = new Set([
	'env_combined_light_probe_volume',
	'env_cubemap_box',
	'env_cubemap'
]);

function indoorLevel(entity: Entity): number {
	return number(entity, 'indoor_outdoor_level', 0);
}

async function probesFrom(
	entities: Entity[],
	pack: PackBuilder,
	vpks: Vpk[]
): Promise<PackProbes | null> {
	const volumes = entities.filter(
		(e) =>
			PROBE_CLASSES.has(className(e)) &&
			enabled(e) &&
			e.has('light_probe_atlas_x') &&
			text(e, 'lightprobetexture')
	);
	if (!volumes.length) return null;
	const irradiance = text(volumes[0]!, 'lightprobetexture')!;
	const shadows = text(volumes[0]!, 'lightprobetexture_dlshd') ?? null;
	if (!(await pack.addTexture(irradiance, vpks, 'probes'))) return null;
	const hasShadows = shadows ? (await pack.addTexture(shadows, vpks, 'probes')) !== null : false;

	const size = (e: Entity): Vec3 => [
		number(e, 'light_probe_size_x', 1),
		number(e, 'light_probe_size_y', 1),
		number(e, 'light_probe_size_z', 1)
	];
	const lengthSq = (v: Vec3) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2];

	return {
		irradiance,
		shadows: hasShadows ? shadows : null,
		volumes: volumes
			.filter((e) => text(e, 'lightprobetexture') === irradiance)
			.sort((a, b) => indoorLevel(b) - indoorLevel(a) || lengthSq(size(a)) - lengthSq(size(b)))
			.map((e) => ({
				origin: vec3(e, 'origin', [0, 0, 0]),
				angles: vec3(e, 'angles', [0, 0, 0]),
				min: vec3(e, 'box_mins', [-64, -64, -64]),
				max: vec3(e, 'box_maxs', [64, 64, 64]),
				edgeFade: vec3(e, 'edge_fade_dists', [16, 16, 16]),
				atlasOffset: [
					number(e, 'light_probe_atlas_x', 0),
					number(e, 'light_probe_atlas_y', 0),
					number(e, 'light_probe_atlas_z', 0)
				],
				atlasSize: size(e)
			}))
	};
}

export function envMapNormalization(radianceSh: number[] | undefined, arrayIndex: number): Vec4 {
	const perChannel = 9;
	const offset = arrayIndex * perChannel * 3;
	if (!radianceSh || arrayIndex < 0 || offset + perChannel * 3 > radianceSh.length)
		return [0, 0, 0, 0];
	const luma = [0, 1, 2, 3].map(
		(band) =>
			radianceSh[offset + band]! * 0.2125 +
			radianceSh[offset + perChannel + band]! * 0.7154 +
			radianceSh[offset + perChannel * 2 + band]! * 0.0721
	);
	const linear = 0.325735;
	return [luma[3]! * linear, luma[1]! * linear, luma[2]! * linear, luma[0]! * 0.282095];
}

async function envMapsFrom(
	entities: Entity[],
	pack: PackBuilder,
	vpks: Vpk[]
): Promise<PackEnvMaps | null> {
	const volumes = entities.filter(
		(e) =>
			ENV_MAP_CLASSES.has(className(e)) &&
			enabled(e) &&
			text(e, 'cubemaptexture') &&
			!text(e, 'customcubemaptexture')
	);
	if (!volumes.length) return null;
	const texture = text(volumes[0]!, 'cubemaptexture')!.replace(/_c$/, '');
	const ref = await pack.addTexture(texture, vpks, 'envmaps');
	if (!ref || ref.faces !== 6) return null;
	const radianceSh = pack.radianceSh.get(texture);
	const arrayIndex = (e: Entity) => number(e, 'array_index', 0);

	return {
		texture,
		volumes: volumes
			.filter((e) => text(e, 'cubemaptexture')!.replace(/_c$/, '') === texture)
			.filter((e) => arrayIndex(e) < ref.depth)
			.sort((a, b) => indoorLevel(b) - indoorLevel(a) || arrayIndex(a) - arrayIndex(b))
			.map((e) => {
				const sphere = className(e) === 'env_cubemap';
				const radius = number(e, 'influenceradius', 512);
				return {
					origin: vec3(e, 'origin', [0, 0, 0]),
					angles: vec3(e, 'angles', [0, 0, 0]),
					min: sphere ? [-radius, -radius, -radius] : vec3(e, 'box_mins', [-64, -64, -64]),
					max: sphere ? [radius, radius, radius] : vec3(e, 'box_maxs', [64, 64, 64]),
					edgeFade: vec3(e, 'edge_fade_dists', [8, 8, 8]),
					arrayIndex: arrayIndex(e),
					box: !sphere,
					normalization: envMapNormalization(radianceSh, arrayIndex(e))
				};
			})
	};
}

async function prepareGltf(gltfPath: string, processed: string, lightmapUvScale: number | null) {
	const gltf = JSON.parse(await readFile(gltfPath, 'utf8')) as Gltf;
	const binName = (gltf.buffers as { uri?: string }[] | undefined)?.[0]?.uri;
	if (!binName) throw new Error('The glTF has no buffer');
	const bin = await readFile(join(dirname(gltfPath), decodeURIComponent(binName)));
	const result = processWorldGltf(gltf, bin, lightmapUvScale);
	const repacked = repackBuffers(gltf, bin);
	const binPath = processed.replace(/\.gltf$/, '.bin');
	gltf.buffers = [{ byteLength: repacked.bin.length, uri: basename(binPath) }];
	await writeFile(binPath, repacked.bin);
	await writeFile(processed, JSON.stringify(gltf));
	return { ...result, compacted: repacked.compacted };
}

async function exportWorld(
	source: WorldSource,
	options: ExportOptions,
	vrf: Vrf,
	pack: PackBuilder,
	vpks: Vpk[]
): Promise<{ world: PackWorld; entities: Entity[] }> {
	const { log, tools } = options;
	const worldFolder = dirname(source.worldPath);
	const workDir = join(options.workDir, source.id);
	const gltfDir = join(workDir, 'gltf');
	const gltfPath = join(gltfDir, worldFolder, 'world.gltf');
	const reuse = options.reuseWork && existsSync(gltfPath);
	if (!reuse) await rm(workDir, { recursive: true, force: true });
	await mkdir(workDir, { recursive: true });
	const started = Date.now();
	const seconds = () => `${((Date.now() - started) / 1000).toFixed(0)} s`;

	log(`${source.id}: reading world info`);
	const worldData = kv3Object(await vrf.dataBlock(source.vpk.path, source.worldPath));
	const lighting = kv3Object(worldData?.m_worldLightingInfo);
	const uvScale = kv3Array(lighting?.m_vLightmapUvScale);
	const lightmapUvScale = typeof uvScale[0] === 'number' ? uvScale[0] : null;
	const lightmapFiles = kv3Array(lighting?.m_lightMaps)
		.map((value) => resourcePath(value))
		.filter((value): value is string => value !== null);

	const entities = await readEntities(vrf, source.vpk, worldFolder, workDir);

	if (!reuse) {
		log(`${source.id}: exporting geometry and materials with Source 2 Viewer`);
		await mkdir(gltfDir, { recursive: true });
		await vrf.exportGltf(source.vpk.path, source.worldPath, gltfDir + sep);
		if (!existsSync(gltfPath)) throw new Error(`Source 2 Viewer wrote no ${gltfPath}`);
	}

	const processed = join(dirname(gltfPath), 'world.processed.gltf');
	const result = await prepareGltf(gltfPath, processed, lightmapUvScale);
	log(
		`${source.id}: [${seconds()}] ${result.primitives} primitives (${result.lightmapped} lightmapped, ${result.compacted} compacted, ${result.dropped} tool primitives dropped, ${result.disabled} disabled entities skipped), ${result.materials} materials, ${result.textures.size} textures`
	);

	const glb = join(workDir, `${source.id}.glb`);
	await run(tools.gltfpack, [
		'-i',
		processed,
		'-o',
		glb,
		'-cc',
		'-kv',
		'-km',
		'-ke',
		'-vtf',
		'-vp',
		'16'
	]);
	const model = await pack.addFile(`${source.id}.glb`, await readFile(glb), true);

	log(`${source.id}: [${seconds()}] packing ${result.textures.size} textures`);
	await forEachLimit([...result.textures].sort(), TEXTURE_CONCURRENCY, (texture) =>
		pack.addTexture(texture, vpks)
	);

	let lightmaps: PackLightmaps | null = null;
	if (lighting?.m_bHasLightmaps !== false && lightmapFiles.length) {
		const files = new Map<string, string>();
		for (const file of lightmapFiles) {
			const name = basename(file).replace(/\.vtex$/, '');
			if (name === 'debug_chart_color') continue;
			const ref = await pack.addTexture(file, [source.vpk, ...vpks], `lightmaps/${source.id}`);
			if (ref) files.set(name, file.replace(/_c$/, ''));
		}
		const irradiance = files.get('irradiance') ?? files.get('directional_irradiance_sh2_dc');
		if (irradiance) {
			const sh = ['r', 'g', 'b'].map((c) => files.get(`directional_irradiance_sh2_${c}`));
			lightmaps = {
				version:
					typeof lighting?.m_nLightmapGameVersionNumber === 'number'
						? lighting.m_nLightmapGameVersionNumber
						: 0,
				irradiance,
				directional: files.get('directional_irradiance') ?? null,
				directionalSh: sh.every(Boolean) ? (sh as [string, string, string]) : null,
				shadows: files.get('direct_light_shadows') ?? null
			};
		}
	}

	const probes = await probesFrom(entities, pack, [source.vpk, ...vpks]);
	const envMaps = await envMapsFrom(entities, pack, [source.vpk, ...vpks]);
	log(`${source.id}: [${seconds()}] done`);
	if (!options.keepWork) await rm(gltfDir, { recursive: true, force: true });

	const skyCamera = findClass(entities, 'sky_camera');
	return {
		entities,
		world: {
			id: source.id,
			kind: source.kind,
			model,
			lightmaps,
			probes,
			envMaps,
			sun: sunFrom(entities),
			skyCamera:
				source.kind === 'skybox' && skyCamera
					? { origin: vec3(skyCamera, 'origin', [0, 0, 0]), scale: number(skyCamera, 'scale', 16) }
					: null
		}
	};
}

async function readMaterial(vrf: Vrf, vpks: Vpk[], material: string) {
	const compiled = `${material.replace(/_c$/, '')}_c`;
	const vpk = vpks.find((candidate) => candidate.has(compiled));
	if (!vpk) return null;
	const data = await vrf.dataBlock(vpk.path, compiled);
	return {
		textures: params(data, 'm_textureParams', 'm_pValue'),
		floats: params(data, 'm_floatParams', 'm_flValue')
	};
}

function floatParam(values: Map<string, Kv3Value>, name: string): number {
	const value = values.get(name);
	return typeof value === 'number' ? value : 0;
}

async function exportSky(
	entities: Entity[],
	vrf: Vrf,
	pack: PackBuilder,
	vpks: Vpk[]
): Promise<{ sky: PackSky | null; skies: Map<string, { sky: PackSky; scale: number }> }> {
	const skies = new Map<string, { sky: PackSky; scale: number }>();
	let main: PackSky | null = null;
	for (const entity of entities) {
		if (className(entity) !== 'env_sky') continue;
		const materialName = text(entity, 'skyname');
		if (!materialName || !materialName.endsWith('.vmat')) continue;
		const material = await readMaterial(vrf, vpks, materialName);
		const texturePath = resourcePath(material?.textures.get('g_tSkyTexture'));
		if (!material || !texturePath) continue;
		const ref = await pack.addTexture(texturePath, vpks, 'sky');
		if (!ref) continue;

		const compiled = `${texturePath.replace(/_c$/, '')}_c`;
		const vpk = vpks.find((candidate) => candidate.has(compiled));
		const radianceSh = vpk ? parseVtex(await vpk.read(compiled)).info.radianceSh : null;
		const scale = number(entity, 'brightnessscale', 1);
		const sky: PackSky = {
			texture: texturePath.replace(/_c$/, ''),
			exposureBias:
				floatParam(material.floats, 'g_flBrightnessExposureBias') +
				floatParam(material.floats, 'g_flRenderOnlyExposureBias'),
			tint: vec3(entity, 'tint_color', [255, 255, 255]).map(
				(c) => (c / 255) * (scale > 0 ? scale : 1)
			) as Vec3,
			angles: vec3(entity, 'angles', [0, 0, 0]),
			radianceSh
		};
		const targetName = text(entity, 'targetname');
		if (targetName) skies.set(targetName, { sky, scale: scale > 0 ? scale : 1 });
		if (!main && enabled(entity)) main = sky;
	}
	return { sky: main, skies };
}

async function fogFrom(
	entities: Entity[],
	skies: Map<string, { sky: PackSky; scale: number }>,
	mainSky: PackSky | null,
	vrf: Vrf,
	pack: PackBuilder,
	vpks: Vpk[]
): Promise<PackFog | null> {
	let cubemap: PackCubemapFog | null = null;
	const cube = entities.find((e) => className(e) === 'env_cubemap_fog' && enabled(e));
	if (cube) {
		const source = number(cube, 'cubemapfogsource', 0);
		let sky: PackSky | null = null;
		let exposureBias = 0;
		if (source === 1) {
			const named = skies.get(text(cube, 'cubemapfogskyentity') ?? '');
			sky = named?.sky ?? mainSky;
			exposureBias = sky ? sky.exposureBias + Math.log2(named?.scale ?? 1) : 0;
		} else if (source === 2) {
			const materialName = text(cube, 'cubemapfogskymaterial');
			const material = materialName ? await readMaterial(vrf, vpks, materialName) : null;
			const texturePath = resourcePath(material?.textures.get('g_tSkyTexture'));
			if (material && texturePath && (await pack.addTexture(texturePath, vpks, 'sky'))) {
				sky = {
					texture: texturePath.replace(/_c$/, ''),
					exposureBias: 0,
					tint: [1, 1, 1],
					angles: [0, 0, 0],
					radianceSh: null
				};
				exposureBias =
					floatParam(material.floats, 'g_flBrightnessExposureBias') +
					floatParam(material.floats, 'g_flRenderOnlyExposureBias');
			}
		}
		if (sky) {
			const useHeight = text(cube, 'cubemapheightfog') !== 'false';
			const heightStart = number(cube, 'cubemapfogheightstart', 0);
			cubemap = {
				start: number(cube, 'cubemapfogstartdistance', 0),
				end: number(cube, 'cubemapfogenddistance', 10000),
				falloffExponent: number(cube, 'cubemapfogfalloffexponent', 1),
				useHeight,
				heightStart,
				heightEnd: cube.has('cubemapfogheightend')
					? number(cube, 'cubemapfogheightend', 0)
					: heightStart + number(cube, 'cubemapfogheightwidth', 0),
				heightExponent: number(cube, 'cubemapfogheightexponent', 1),
				lodBias: number(cube, 'cubemapfoglodbiase', 0),
				maxOpacity: number(cube, 'cubemapfogmaxopacity', 1),
				exposureBias,
				texture: sky.texture,
				angles: sky.angles
			};
		}
	}

	let gradient: PackGradientFog | null = null;
	const grad = entities.find((e) => className(e) === 'env_gradient_fog' && enabled(e));
	if (grad) {
		gradient = {
			start: number(grad, 'fogstart', 0),
			end: number(grad, 'fogend', 10000),
			falloffExponent: number(grad, 'fogfalloffexponent', 2),
			heightStart: number(grad, 'fogstartheight', 0),
			heightEnd: number(grad, 'fogendheight', 0),
			heightExponent: number(grad, 'fogverticalexponent', 1),
			color: vec3(grad, 'fogcolor', [255, 255, 255]).map((c) => c / 255) as Vec3,
			strength: number(grad, 'fogstrength', 1),
			maxOpacity: number(grad, 'fogmaxopacity', 1)
		};
	}

	return cubemap || gradient ? { cubemap, gradient } : null;
}

function exposureFrom(entities: Entity[]): MapPackManifest['exposure'] {
	const volumes = entities.filter((e) => className(e) === 'post_processing_volume');
	const volume = volumes.find((e) => text(e, 'master') === 'true') ?? volumes[0];
	if (!volume || text(volume, 'enableexposure') === 'false') return null;
	return { min: number(volume, 'minexposure', 1), max: number(volume, 'maxexposure', 1) };
}

function numberField(object: Record<string, Kv3Value> | undefined, key: string, fallback: number) {
	const value = object?.[key];
	return typeof value === 'number' ? value : fallback;
}

export function bloomBlendMode(value: Kv3Value | undefined): BloomBlendMode | undefined {
	if (typeof value === 'number') return (['add', 'screen', 'blur'] as const)[value];
	if (typeof value !== 'string') return undefined;
	if (value.endsWith('SCREEN')) return 'screen';
	if (value.endsWith('BLUR')) return 'blur';
	if (value.endsWith('ADD')) return 'add';
	return undefined;
}

function bloomBlend(params: Record<string, Kv3Value>): Partial<PackBloom> {
	const weights = kv3Array(params.m_flBlurWeight).filter((v): v is number => typeof v === 'number');
	const tints = kv3Array(params.m_vBlurTint)
		.map((tint) => kv3Array(tint).filter((v): v is number => typeof v === 'number'))
		.filter((tint) => tint.length >= 3)
		.map((tint) => [tint[0]!, tint[1]!, tint[2]!] as Vec3);
	const blendMode = bloomBlendMode(params.m_blendMode);
	return {
		...(blendMode ? { blendMode } : {}),
		...(weights.length === 5 ? { blurWeights: weights } : {}),
		...(tints.length === 5 ? { blurTints: tints } : {})
	};
}

async function postProcessFrom(
	entities: Entity[],
	vrf: Vrf,
	pack: PackBuilder,
	vpks: Vpk[]
): Promise<PackPostProcess | null> {
	const volumes = entities.filter((e) => className(e) === 'post_processing_volume');
	const volume = volumes.find((e) => text(e, 'master') === 'true') ?? volumes[0];
	const resource = volume ? text(volume, 'postprocessing') : undefined;
	if (!resource) return null;
	const compiled = `${resource.replace(/_c$/, '')}_c`;
	const vpk = vpks.find((candidate) => candidate.has(compiled));
	if (!vpk) return null;
	const data = kv3Object(await vrf.dataBlock(vpk.path, compiled));
	if (!data) return null;

	const tonemapParams =
		data.m_bHasTonemapParams !== false ? kv3Object(data.m_toneMapParams) : undefined;
	const bloomParams = data.m_bHasBloomParams === true ? kv3Object(data.m_bloomParams) : undefined;
	let lut: string | null = null;
	const lutData = data.m_colorCorrectionVolumeData;
	const dim = numberField(data, 'm_nColorCorrectionVolumeDim', 0);
	if (
		data.m_bHasColorCorrection === true &&
		lutData instanceof Uint8Array &&
		dim > 0 &&
		lutData.length === dim ** 3 * 4
	) {
		lut = `${resource.replace(/_c$/, '')}#lut`;
		await pack.addRawTexture(lut, 'postprocess', {
			width: dim,
			height: dim,
			depth: dim,
			faces: 1,
			mips: 1,
			format: 'rgba8',
			flags: TEXTURE_VOLUME | TEXTURE_CLAMP_S | TEXTURE_CLAMP_T,
			mipData: [lutData]
		});
	}

	return {
		tonemap: tonemapParams
			? {
					exposureBias: numberField(tonemapParams, 'm_flExposureBias', 0),
					shoulderStrength: numberField(tonemapParams, 'm_flShoulderStrength', 0.15),
					linearStrength: numberField(tonemapParams, 'm_flLinearStrength', 0.5),
					linearAngle: numberField(tonemapParams, 'm_flLinearAngle', 0.1),
					toeStrength: numberField(tonemapParams, 'm_flToeStrength', 0.2),
					toeNum: numberField(tonemapParams, 'm_flToeNum', 0.02),
					toeDenom: numberField(tonemapParams, 'm_flToeDenom', 0.3),
					whitePoint: numberField(tonemapParams, 'm_flWhitePoint', 4)
				}
			: null,
		bloom: bloomParams
			? {
					strength: numberField(bloomParams, 'm_flBloomStrength', 0),
					screenStrength: numberField(bloomParams, 'm_flScreenBloomStrength', 0),
					blurStrength: numberField(bloomParams, 'm_flBlurBloomStrength', 0),
					threshold: numberField(bloomParams, 'm_flBloomThreshold', 1),
					thresholdWidth: numberField(bloomParams, 'm_flBloomThresholdWidth', 1),
					skyboxStrength: numberField(bloomParams, 'm_flSkyboxBloomStrength', 1),
					...bloomBlend(bloomParams)
				}
			: null,
		lut
	};
}

async function openSearchPaths(csgo: string): Promise<Vpk[]> {
	const game = dirname(csgo);
	const vpks: Vpk[] = [];
	for (const folder of ['csgo', 'csgo_imported', 'csgo_core', 'core']) {
		const path = join(game, folder, 'pak01_dir.vpk');
		if (existsSync(path)) vpks.push(await Vpk.open(path));
	}
	return vpks;
}

export function worldPathIn(vpk: Vpk, map: string): string {
	const own = `maps/${map}/world.vwrld_c`;
	if (vpk.has(own)) return own;
	const worlds = vpk
		.list('maps/')
		.filter((path) => /^maps\/[^/]+\/world\.vwrld_c$/.test(path) && !/skybox|_sky\//.test(path))
		.sort((a, b) => (vpk.size(b) ?? 0) - (vpk.size(a) ?? 0));
	return worlds[0] ?? own;
}

export async function exportMap(options: ExportOptions): Promise<{ pack: string; bytes: number }> {
	const { map, csgo, log } = options;
	const mapVpkPath = options.mapVpk ?? join(csgo, 'maps', `${map}.vpk`);
	if (!existsSync(mapVpkPath)) throw new Error(`${map} is not installed (${mapVpkPath})`);

	await mkdir(options.outDir, { recursive: true });
	if (!options.reuseWork) await rm(options.workDir, { recursive: true, force: true });
	await mkdir(options.workDir, { recursive: true });
	const packPath = join(options.outDir, `${map}.zip`);
	const partPath = join(options.workDir, `${map}.zip`);

	const vrf = new Vrf(options.tools.vrf, join(csgo, 'gameinfo.gi'));
	const mapVpk = await Vpk.open(mapVpkPath);
	const shared = await openSearchPaths(csgo);
	const opened: Vpk[] = [mapVpk, ...shared];
	const pack = new PackBuilder(partPath, log, options.maxTextureSize);

	try {
		const main = await exportWorld(
			{ id: 'world', kind: 'world', vpk: mapVpk, worldPath: worldPathIn(mapVpk, map) },
			options,
			vrf,
			pack,
			[mapVpk, ...shared]
		);
		const worlds: PackWorld[] = [main.world];
		const entities = [...main.entities];

		let skyboxIndex = 0;
		for (const reference of main.entities.filter((e) => className(e) === 'skybox_reference')) {
			const target = text(reference, 'targetmapname');
			if (!target) continue;
			const vpkPath = join(csgo, target.replace(/\.vmap$/, '.vpk'));
			if (!existsSync(vpkPath)) {
				log(`  3D skybox ${target} is not installed`);
				continue;
			}
			const skyboxVpk = await Vpk.open(vpkPath);
			opened.push(skyboxVpk);
			const worldPath = `${target.replace(/\.vmap$/, '')}/world.vwrld_c`;
			if (!skyboxVpk.has(worldPath)) {
				log(`  ${vpkPath} has no ${worldPath}`);
				continue;
			}
			const id = skyboxIndex === 0 ? 'skybox' : `skybox${skyboxIndex + 1}`;
			skyboxIndex++;
			const skybox = await exportWorld(
				{ id, kind: 'skybox', vpk: skyboxVpk, worldPath },
				options,
				vrf,
				pack,
				[skyboxVpk, mapVpk, ...shared]
			);
			worlds.push(skybox.world);
			entities.push(...skybox.entities);
		}

		log('Reading sky, sun and fog');
		const { sky, skies } = await exportSky(entities, vrf, pack, opened);
		const fog = await fogFrom(entities, skies, sky, vrf, pack, opened);
		const postProcess = await postProcessFrom(main.entities, vrf, pack, opened);
		const light = main.entities.find((e) => className(e) === 'light_environment' && enabled(e));

		const manifest: MapPackManifest = {
			version: MAP_PACK_VERSION,
			map,
			exportedAt: new Date().toISOString(),
			build: gameBuild(csgo),
			tools: { ...options.tools.versions, exporter: EXPORTER_VERSION },
			worlds,
			textures: pack.textures,
			sky,
			ambient: light
				? {
						skyColor: linearColor(light, 'skycolor', [255, 255, 255]),
						skyIntensity: number(light, 'skyintensity', 1)
					}
				: null,
			exposure: exposureFrom(main.entities),
			postProcess,
			fog
		};
		await pack.addFile(
			MAP_PACK_MANIFEST,
			new TextEncoder().encode(JSON.stringify(manifest)),
			false
		);
		await pack.close();
		log(`Moving the pack to ${packPath}`);
		await rename(partPath, packPath).catch(async (error: NodeJS.ErrnoException) => {
			if (error.code !== 'EXDEV') throw error;
			await copyFile(partPath, packPath);
		});
		return { pack: packPath, bytes: pack.bytes };
	} catch (error) {
		await pack.close().catch(() => {});
		throw error;
	} finally {
		await Promise.all(opened.map((vpk) => vpk.close()));
		if (!options.keepWork) await rm(options.workDir, { recursive: true, force: true });
	}
}
