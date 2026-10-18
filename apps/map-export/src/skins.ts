import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import {
	SKINS_PACK_MANIFEST,
	SKINS_PACK_NAME,
	SKINS_PACK_VERSION,
	decodePackTexture,
	encodePackTexture,
	isGlovesItem,
	itemWeaponKey,
	skinWeaponKey,
	type Cosmetics,
	type SkinGlove,
	type PaintRoll,
	type SkinPaint,
	type SkinWeapon,
	type PackTexture,
	type SkinsPackManifest
} from '@cs-demo-cloud/replay';
import { openZipFile, ZipWriter } from '@cs-demo-cloud/shared/zip';
import { EXPORTER_VERSION, forEachLimit, limitTextureSize, PackBuilder } from './export.ts';
import { kv3Array, kv3Object, type Kv3Object, type Kv3Value } from './kv3.ts';
import { parseKv1, type Kv1Object } from './kv1.ts';
import {
	CHARACTER_MESHES,
	exportModel,
	SKELETON_ROOT,
	TEXTURE_PARAMS,
	WEAPON_BONE,
	WEAPON_MODELS
} from './players.ts';
import { gameBuild } from './steam.ts';
import type { Tools } from './tools.ts';
import { run, Vrf } from './vrf.ts';
import { Vpk } from './vpk.ts';
import { parseVtex } from './vtex.ts';
import { ResamplePool } from './resample.ts';

export interface SkinsExportOptions {
	csgo: string;
	outDir: string;
	workDir: string;
	tools: Tools;
	cosmetics: Cosmetics | 'all';
	patternSize?: number;
	log: (message: string) => void;
	keepWork?: boolean;
	reuseWork?: boolean;
}

export interface MaterialParams {
	shader: string;
	ints: Record<string, number>;
	floats: Record<string, number>;
	vectors: Record<string, number[]>;
	textures: Record<string, string>;
	strings: Record<string, string>;
}

export interface PaintKit {
	name: string;
	style: number;
	legacy: boolean;
	wear: [number, number];
	composite: string | null;
	vmat: string | null;
}

const PAINT_TEXTURES = new Set([
	'g_tPattern',
	'g_tNormal',
	'g_tWear',
	'g_tGrunge',
	'g_tPaintByNumberMasks',
	'g_tPaintRoughness',
	'g_tPaintMetalness',
	'g_tFinalAmbientOcclusion',
	'g_tOverlay'
]);
const COMPOSITE_TEXTURES = new Set([
	'g_tMasks',
	'g_tAmbientOcclusion',
	'g_tColor',
	'g_tMetalness',
	'g_tRoughness',
	'g_tSurface',
	'g_tPosition'
]);
const SKIPPED_VARIABLES = new Set(['g_nRandomSeed', 'g_flWearAmount']);
const PATTERN_SIZE = 1024;
const DETAIL_SIZE = 512;
const AGENT_TEXTURE_SIZE = 1024;

export function paintKits(itemsGame: string): Map<number, PaintKit> {
	const root = parseKv1(itemsGame).items_game as Kv1Object | undefined;
	const kits = new Map<number, PaintKit>();
	const block = root?.paint_kits;
	if (!block || typeof block !== 'object') return kits;
	for (const [index, value] of Object.entries(block)) {
		if (typeof value !== 'object' || typeof value.name !== 'string') continue;
		const number = (key: string, fallback: number) => {
			const raw = value[key];
			const parsed = typeof raw === 'string' ? Number(raw) : NaN;
			return Number.isFinite(parsed) ? parsed : fallback;
		};
		kits.set(Number(index), {
			name: value.name,
			style: number('style', 0),
			legacy: value.use_legacy_model === '1',
			wear: [number('wear_remap_min', 0.06), number('wear_remap_max', 0.8)],
			composite:
				typeof value.composite_material_path === 'string' ? value.composite_material_path : null,
			vmat: typeof value.vmt_path === 'string' ? value.vmt_path : null
		});
	}
	return kits;
}

export function materialParams(data: Kv3Value): MaterialParams {
	const object = kv3Object(data) ?? {};
	const params: MaterialParams = {
		shader: typeof object.m_shaderName === 'string' ? object.m_shaderName : '',
		ints: {},
		floats: {},
		vectors: {},
		textures: {},
		strings: {}
	};
	const each = (key: string, read: (entry: Kv3Object, name: string) => void) => {
		for (const entry of kv3Array(object[key])) {
			const item = kv3Object(entry);
			if (item && typeof item.m_name === 'string') read(item, item.m_name);
		}
	};
	each('m_intParams', (entry, name) => {
		if (typeof entry.m_nValue === 'number') params.ints[name] = entry.m_nValue;
	});
	each('m_floatParams', (entry, name) => {
		if (typeof entry.m_flValue === 'number') params.floats[name] = entry.m_flValue;
	});
	each('m_vectorParams', (entry, name) => {
		const value = kv3Array(entry.m_value);
		if (value.every((v) => typeof v === 'number')) params.vectors[name] = value as number[];
	});
	each('m_textureParams', (entry, name) => {
		if (typeof entry.m_pValue === 'string') params.textures[name] = entry.m_pValue;
	});
	each('m_stringAttributes', (entry, name) => {
		if (typeof entry.m_value === 'string') params.strings[name] = entry.m_value;
	});
	return params;
}

export function compositePaint(data: Kv3Value): {
	material: string | null;
	overrides: MaterialParams;
} {
	const overrides: MaterialParams = {
		shader: '',
		ints: {},
		floats: {},
		vectors: {},
		textures: {},
		strings: {}
	};
	let material: string | null = null;
	const visit = (value: Kv3Value | undefined) => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const object = kv3Object(value);
		if (!object) return;
		if (
			object.m_nCompositeMaterialInputContainerSourceType ===
				'CONTAINER_SOURCE_TYPE_SPECIFIC_MATERIAL' &&
			object.m_strAlias === 'paint' &&
			typeof object.m_strSpecificContainerMaterial === 'string'
		)
			material = object.m_strSpecificContainerMaterial;
		for (const variable of kv3Array(object.m_vecLooseVariables)) {
			const entry = kv3Object(variable);
			if (!entry || typeof entry.m_strName !== 'string') continue;
			if (SKIPPED_VARIABLES.has(entry.m_strName)) continue;
			applyVariable(overrides, entry.m_strName, entry);
		}
		for (const [key, child] of Object.entries(object))
			if (key !== 'm_vecLooseVariables' && key !== 'm_vecCompMatIncludes') visit(child);
	};
	visit(data);
	return { material, overrides };
}

export interface CompositeRolls {
	includes: string[];
	vars: string[];
	bounds: Map<string, [number, number][]>;
}

const COMPONENTS = 'xyzw';

export function compositeRolls(data: Kv3Value | null): CompositeRolls {
	const out: CompositeRolls = { includes: [], vars: [], bounds: new Map() };
	const visit = (value: Kv3Value | undefined) => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const object = kv3Object(value);
		if (!object) return;
		for (const include of kv3Array(object.m_vecCompMatIncludes))
			if (typeof include === 'string') out.includes.push(include);
		if (object.m_nMutatorCommandType === 'COMP_MAT_PROPERTY_MUTATOR_RANDOM_ROLL_INPUT_VARIABLES')
			for (const name of kv3Array(object.m_vecRandomRollInputVars_InputVarsToRoll))
				if (typeof name === 'string') out.vars.push(name);
		for (const variable of kv3Array(object.m_vecLooseVariables)) {
			const entry = kv3Object(variable);
			if (!entry || typeof entry.m_strName !== 'string') continue;
			const ranges: [number, number][] = [];
			for (const axis of 'XYZW') {
				const value = entry[`m_flValueFloat${axis}`];
				if (typeof value !== 'number') break;
				const min = entry[`m_flValueFloat${axis}_Min`];
				const max = entry[`m_flValueFloat${axis}_Max`];
				ranges.push(
					entry.m_bHasFloatBounds === true && typeof min === 'number' && typeof max === 'number'
						? [min, max]
						: [value, value]
				);
			}
			if (ranges.length) out.bounds.set(entry.m_strName, ranges);
		}
		for (const [key, child] of Object.entries(object))
			if (key !== 'm_vecLooseVariables' && key !== 'm_vecCompMatIncludes') visit(child);
	};
	visit(data ?? undefined);
	return out;
}

export function paintRolls(recipes: CompositeRolls[]): PaintRoll[] {
	const rolls: PaintRoll[] = [];
	const vars = recipes.flatMap((recipe) => recipe.vars);
	for (const path of vars) {
		const parts = path.split('.');
		const swizzle = parts.length >= 3 ? parts.pop()! : 'x';
		const name = parts[parts.length - 1]!;
		const ranges = recipes.map((recipe) => recipe.bounds.get(name)).find(Boolean);
		if (!ranges) continue;
		for (const letter of swizzle) {
			const component = COMPONENTS.indexOf(letter);
			const range = ranges[component];
			if (component < 0 || !range) continue;
			rolls.push([name, component, range[0], range[1]]);
		}
	}
	return rolls;
}

function applyVariable(params: MaterialParams, name: string, entry: Kv3Object) {
	const num = (key: string) => (typeof entry[key] === 'number' ? (entry[key] as number) : 0);
	switch (entry.m_nVariableType) {
		case 'LOOSE_VARIABLE_TYPE_BOOLEAN':
			params.ints[name] = entry.m_bValueBoolean === true ? 1 : 0;
			break;
		case 'LOOSE_VARIABLE_TYPE_INTEGER1':
			params.ints[name] = num('m_nValueIntX');
			break;
		case 'LOOSE_VARIABLE_TYPE_FLOAT1':
			params.floats[name] = num('m_flValueFloatX');
			break;
		case 'LOOSE_VARIABLE_TYPE_FLOAT2':
			params.vectors[name] = [num('m_flValueFloatX'), num('m_flValueFloatY'), 0, 0];
			break;
		case 'LOOSE_VARIABLE_TYPE_FLOAT3':
			params.vectors[name] = [
				num('m_flValueFloatX'),
				num('m_flValueFloatY'),
				num('m_flValueFloatZ'),
				0
			];
			break;
		case 'LOOSE_VARIABLE_TYPE_FLOAT4':
			params.vectors[name] = [
				num('m_flValueFloatX'),
				num('m_flValueFloatY'),
				num('m_flValueFloatZ'),
				num('m_flValueFloatW')
			];
			break;
		case 'LOOSE_VARIABLE_TYPE_COLOR4': {
			const color = kv3Array(entry.m_cValueColor4).map((v) =>
				typeof v === 'number' ? v / 255 : 1
			);
			params.vectors[name] = [color[0] ?? 1, color[1] ?? 1, color[2] ?? 1, color[3] ?? 1];
			break;
		}
		case 'LOOSE_VARIABLE_TYPE_RESOURCE_TEXTURE':
			if (typeof entry.m_strTextureRuntimeResourcePath === 'string')
				params.textures[name] = entry.m_strTextureRuntimeResourcePath;
			break;
	}
}

export function mergeParams(base: MaterialParams, overrides: MaterialParams): MaterialParams {
	return {
		shader: base.shader,
		ints: { ...base.ints, ...overrides.ints },
		floats: { ...base.floats, ...overrides.floats },
		vectors: { ...base.vectors, ...overrides.vectors },
		textures: { ...base.textures, ...overrides.textures },
		strings: { ...base.strings, ...overrides.strings }
	};
}

async function recipeRolls(blocks: Blocks, recipe: Kv3Value | null): Promise<PaintRoll[]> {
	const own = compositeRolls(recipe);
	const included = await Promise.all(
		own.includes.map(async (path) => compositeRolls(await blocks.read(path)))
	);
	return paintRolls([own, ...included]);
}

class Blocks {
	private cache = new Map<string, Promise<Kv3Value | null>>();
	private vrf: Vrf;
	private vpk: string;
	private dir: string;
	private log: (message: string) => void;

	constructor(vrf: Vrf, vpk: string, dir: string, log: (message: string) => void) {
		this.vrf = vrf;
		this.vpk = vpk;
		this.dir = dir;
		this.log = log;
	}

	read(path: string): Promise<Kv3Value | null> {
		let promise = this.cache.get(path);
		if (!promise) {
			const file = this.file(path);
			promise = (async () => {
				if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8')) as Kv3Value | null;
				try {
					const data = await this.vrf.dataBlock(this.vpk, `${path}_c`);
					await mkdir(this.dir, { recursive: true });
					await writeFile(file, JSON.stringify(data));
					return data;
				} catch (error) {
					this.log(`  ${path} unreadable: ${(error as Error).message.split('\n')[0]}`);
					return null;
				}
			})();
			this.cache.set(path, promise);
		}
		return promise;
	}

	async prefetch(paths: string[]) {
		const missing = [...new Set(paths)].filter(
			(path) => !this.cache.has(path) && !existsSync(this.file(path))
		);
		await mkdir(this.dir, { recursive: true });
		for (let i = 0; i < missing.length; i += 60) {
			const batch = missing.slice(i, i + 60);
			const found = await this.vrf
				.dataBlocks(
					this.vpk,
					batch.map((path) => `${path}_c`)
				)
				.catch((error: Error) => {
					this.log(`  reading materials failed: ${error.message.split('\n')[0]}`);
					return new Map<string, Kv3Value>();
				});
			for (const path of batch)
				await writeFile(this.file(path), JSON.stringify(found.get(`${path}_c`) ?? null));
			if (missing.length > 120)
				this.log(`  read ${Math.min(i + 60, missing.length)}/${missing.length}`);
		}
	}

	private file(path: string): string {
		return join(this.dir, `${path.replaceAll('/', '__')}.json`);
	}
}

const KEPT_INTS = new Set([
	'F_PAINT_STYLE',
	'F_OVERRIDE_NORMAL',
	'g_bUseNormalMap',
	'g_bOverrideDefaultMasks',
	'g_bIgnoreWeaponSizeScale',
	'g_bRoughnessPerColor',
	'g_nColorAdjustmentMode'
]);
const KEPT_FLOATS =
	/^g_fl(Pattern|Wear|Grunge)TexCoord(Scale|Rotation)$|^g_fl(ColorBrightness|PaintRoughness|PaintMetalness)$|^g_fWearSoftness$/;
const KEPT_VECTORS =
	/^g_v(Pattern|Wear|Grunge)TexCoordOffset$|^g_vColor[0-3]$|^g_vPaint(Durability|Roughness|Metalness|AlbedoLevels)$|^g_vMetallicPaintAlbedoLevels$|^g_vSprayBiasBlend$/;

export function trimParams(params: MaterialParams) {
	return {
		ints: Object.fromEntries(Object.entries(params.ints).filter(([name]) => KEPT_INTS.has(name))),
		floats: Object.fromEntries(
			Object.entries(params.floats).filter(([name]) => KEPT_FLOATS.test(name))
		),
		vectors: Object.fromEntries(
			Object.entries(params.vectors).filter(([name]) => KEPT_VECTORS.test(name))
		)
	};
}

const GLOVE_TEXTURES: Record<string, 'mask' | 'detail'> = {
	g_tLayerMask: 'mask',
	g_tSurface: 'mask',
	g_tNormal: 'mask',
	g_tPattern: 'detail',
	g_tDetail1: 'detail',
	g_tDetail2: 'detail',
	g_tDetail3: 'detail',
	g_tDetail4: 'detail',
	g_tDetailNormal1: 'detail',
	g_tDetailNormal2: 'detail',
	g_tDetailNormal3: 'detail',
	g_tDetailNormal4: 'detail'
};
const GLOVE_INTS = new Set([
	'F_PATTERN',
	'g_bFlipFixup',
	'g_nPatternMode',
	'g_nPatternReplaceIndex'
]);
const GLOVE_FLOATS =
	/^g_f(ColorMaskBlur|PaintThickness|PaintDurability|PatternDetailInfluence|PatternTexCoord(Scale|Rotation)|PatternRoughnessBrightness|PatternMetalness)$|^g_f(Detail(Scale|BlackPoint|RoughnessContrast|RoughnessBrightness|Metalness|NormalContrast)|CurvaturePower)[1-4]$/;
const GLOVE_VECTORS = /^g_vColorTint[1-8]$|^g_vPatternPaletteIndices$|^g_fPatternTexCoordOffset$/;
const GLOVE_MASK_SIZE = 1024;

export function gloveParams(params: MaterialParams) {
	return {
		ints: Object.fromEntries(Object.entries(params.ints).filter(([name]) => GLOVE_INTS.has(name))),
		floats: Object.fromEntries(
			Object.entries(params.floats).filter(([name]) => GLOVE_FLOATS.test(name))
		),
		vectors: Object.fromEntries(
			Object.entries(params.vectors).filter(([name]) => GLOVE_VECTORS.test(name))
		)
	};
}

export function gloveItems(itemsGame: string): Map<number, { name: string; model: string }> {
	const root = parseKv1(itemsGame).items_game as Kv1Object | undefined;
	const items = new Map<number, { name: string; model: string }>();
	const block = root?.items;
	if (!block || typeof block !== 'object') return items;
	for (const [index, value] of Object.entries(block)) {
		if (typeof value !== 'object' || typeof value.name !== 'string') continue;
		const model = value.model_player;
		if (isGlovesItem(Number(index)) && typeof model === 'string')
			items.set(Number(index), { name: value.name, model });
	}
	return items;
}

export function weaponItems(itemsGame: string): Map<string, number> {
	const root = parseKv1(itemsGame).items_game as Kv1Object | undefined;
	const items = new Map<string, number>();
	const block = root?.items;
	if (!block || typeof block !== 'object') return items;
	for (const [index, value] of Object.entries(block)) {
		if (typeof value !== 'object' || typeof value.name !== 'string') continue;
		if (itemWeaponKey(Number(index))) items.set(value.name, Number(index));
	}
	return items;
}

export function iconCosmetics(
	icons: string[],
	items: Map<string, number>,
	kits: Map<number, PaintKit>
): Cosmetics['paints'] {
	const byName = new Map([...kits].map(([index, kit]) => [kit.name, index]));
	const weapons = [...items.keys()].sort((a, b) => b.length - a.length);
	const paints = new Map<string, { item: number; paint: number }>();
	for (const icon of icons) {
		const weapon = weapons.find((name) => icon.startsWith(`${name}_`));
		if (!weapon) continue;
		const paint = byName.get(icon.slice(weapon.length + 1));
		const item = items.get(weapon)!;
		if (paint !== undefined) paints.set(`${item}:${paint}`, { item, paint });
	}
	return [...paints.values()];
}

function allCosmetics(vpk: Vpk, itemsGame: string, kits: Map<number, PaintKit>): Cosmetics {
	const agents = vpk
		.list('agents/models/')
		.filter((path) => /^agents\/models\/[^/]+\/[^/]+\.vmdl_c$/.test(path))
		.map((path) =>
			path
				.split('/')
				.pop()!
				.replace(/\.vmdl_c$/, '')
		)
		.filter((name) => name !== 'ctm_sas' && name !== 'tm_phoenix');
	const icons = vpk
		.list('panorama/images/econ/default_generated/')
		.filter((path) => path.endsWith('_light_png.vtex_c'))
		.map((path) =>
			path
				.split('/')
				.pop()!
				.replace(/_light_png\.vtex_c$/, '')
		);
	const items = weaponItems(itemsGame);
	for (const [index, glove] of gloveItems(itemsGame)) items.set(glove.name, index);
	return {
		agents: [...new Set(agents)].sort(),
		paints: iconCosmetics(icons, items, kits)
	};
}

function agentModel(vpk: Vpk, agent: string): string | null {
	const file = vpk.list('agents/models/').find((path) => path.endsWith(`/${agent}.vmdl_c`));
	return file ? file.replace(/_c$/, '') : null;
}

export async function fetchCosmetics(source: string, token?: string): Promise<Cosmetics> {
	if (/^https?:\/\//.test(source)) {
		const url = new URL(source);
		if (!url.pathname.startsWith('/api/')) url.pathname = '/api/cosmetics';
		const response = await fetch(url, {
			headers: token ? { authorization: `Bearer ${token}` } : {}
		});
		if (!response.ok) throw new Error(`${url} answered ${response.status}`);
		return (await response.json()) as Cosmetics;
	}
	return JSON.parse(await readFile(source, 'utf8')) as Cosmetics;
}

export async function exportSkins(
	options: SkinsExportOptions
): Promise<{ pack: string; bytes: number }> {
	const { csgo, log, tools } = options;
	const patternSize = options.patternSize ?? PATTERN_SIZE;
	const vpkPath = join(csgo, 'pak01_dir.vpk');
	const gameinfo = join(csgo, 'gameinfo.gi');
	await mkdir(options.outDir, { recursive: true });
	if (!options.reuseWork) await rm(options.workDir, { recursive: true, force: true });
	await mkdir(options.workDir, { recursive: true });
	const packPath = join(options.outDir, `${SKINS_PACK_NAME}.zip`);
	const partPath = join(options.workDir, `${SKINS_PACK_NAME}.zip`);

	const vpk = await Vpk.open(vpkPath);
	const vrf = new Vrf(tools.vrf, gameinfo);
	const blocks = new Blocks(vrf, vpkPath, join(options.workDir, 'blocks'), log);
	const pack = new PackBuilder(partPath, log, AGENT_TEXTURE_SIZE);
	const textures = new Map<string, number>();
	let pool: ResamplePool | null = null;
	const want = (path: string | undefined, size: number) => {
		if (!path) return;
		textures.set(path, Math.max(textures.get(path) ?? 0, size));
	};

	try {
		const itemsGame = new TextDecoder().decode(await vpk.read('scripts/items/items_game.txt'));
		const kits = paintKits(itemsGame);
		const cosmetics =
			options.cosmetics === 'all' ? allCosmetics(vpk, itemsGame, kits) : options.cosmetics;
		log(
			`skins: ${kits.size} paint kits in the game, ${cosmetics.paints.length} skins and ${cosmetics.agents.length} agents to export`
		);

		const agents: Record<string, string> = {};
		for (const agent of cosmetics.agents) {
			const model = agentModel(vpk, agent);
			if (!model) {
				log(`  no model for agent ${agent}`);
				continue;
			}
			log(`skins: exporting agent ${agent}`);
			const exported = await exportModel(
				tools,
				vpkPath,
				gameinfo,
				model,
				join(options.workDir, 'agents', agent),
				[
					'--gltf_export_animations',
					'--gltf_animation_list',
					'idle_rifle',
					'--gltf_mesh_list',
					CHARACTER_MESHES.join(',')
				],
				{
					skeletonRoot: SKELETON_ROOT,
					meshes: (name) => CHARACTER_MESHES.some((mesh) => name.endsWith(`.${mesh}`)),
					part: (name) => (name.includes('.firstperson_') ? 'firstperson' : null),
					textureParams: TEXTURE_PARAMS
				},
				options.reuseWork
			).catch((error: Error) => {
				log(`  ${agent} failed: ${error.message.split('\n')[0]}`);
				return null;
			});
			if (!exported) continue;
			for (const texture of exported.textures) want(texture, AGENT_TEXTURE_SIZE);
			agents[agent] = await pack.addFile(`agents/${agent}.glb`, exported.glb, true);
		}

		const weapons: Record<string, SkinWeapon> = {};
		const paints: Record<string, SkinPaint> = {};
		const pending = new Map<string, Promise<SkinWeapon | null>>();
		const weapon = (key: string, legacy: boolean): Promise<SkinWeapon | null> => {
			const id = skinWeaponKey(key, legacy);
			let promise = pending.get(id);
			if (!promise) {
				promise = exportSkinWeapon(key, legacy).then((result) => {
					if (result) weapons[id] = result;
					return result;
				});
				pending.set(id, promise);
			}
			return promise;
		};

		const exportSkinWeapon = async (key: string, legacy: boolean): Promise<SkinWeapon | null> => {
			const path = WEAPON_MODELS[key];
			if (!path) return null;
			const model = `weapons/models/${path}.vmdl`;
			const exported = await exportModel(
				tools,
				vpkPath,
				gameinfo,
				model,
				join(options.workDir, 'weapon-models', skinWeaponKey(key, legacy).replace(':', '-')),
				['--gltf_export_animations'],
				{
					meshes: legacy
						? (name) => name.endsWith('.body_legacy')
						: (name) => !/\.(body_legacy|body_hidden)$/.test(name),
					textureParams: TEXTURE_PARAMS
				},
				options.reuseWork
			).catch((error: Error) => {
				log(`  ${key} failed: ${error.message.split('\n')[0]}`);
				return null;
			});
			if (!exported) return null;
			const main = exported.materials.find((name) => !name.includes('sticker'));
			const material = main ? await blocks.read(main) : null;
			const inputs = material ? materialParams(material).strings.composite_inputs : undefined;
			const composite = inputs ? await blocks.read(inputs) : null;
			if (!composite) {
				log(`  ${key} has no composite inputs`);
				return null;
			}
			const params = materialParams(composite);
			const result: SkinWeapon = {
				textures: Object.fromEntries(
					Object.entries(params.textures).filter(([name]) => COMPOSITE_TEXTURES.has(name))
				),
				uvScale: params.floats.g_flUvScale1 ?? 1,
				weaponLength: params.floats.g_flWeaponLength1 ?? 32
			};
			for (const texture of Object.values(result.textures)) want(texture, DETAIL_SIZE);
			if (legacy) {
				for (const texture of exported.textures) want(texture, DETAIL_SIZE);
				const bone = exported.nodes[WEAPON_BONE];
				result.model = await pack.addFile(`weapons/${key}-legacy.glb`, exported.glb, true);
				result.translation = bone?.translation ?? [0, 0, 0];
				result.rotation = bone?.rotation ?? [0, 0, 0, 1];
			}
			return result;
		};

		const gloveModels = gloveItems(itemsGame);
		const gloves: Record<string, SkinGlove> = {};
		const pendingGloves = new Map<number, Promise<boolean>>();
		const gloveModel = (item: number): Promise<boolean> => {
			let promise = pendingGloves.get(item);
			if (!promise) {
				promise = (async () => {
					const entry = gloveModels.get(item);
					if (!entry) return false;
					log(`skins: exporting gloves ${entry.name}`);
					const exported = await exportModel(
						tools,
						vpkPath,
						gameinfo,
						entry.model,
						join(options.workDir, 'gloves', String(item)),
						['--gltf_export_animations'],
						{
							part: (name) => (name.endsWith('.viewmodel') ? 'firstperson' : null),
							textureParams: TEXTURE_PARAMS
						},
						options.reuseWork
					).catch((error: Error) => {
						log(`  ${entry.name} failed: ${error.message.split('\n')[0]}`);
						return null;
					});
					if (!exported) return false;
					for (const texture of exported.textures) want(texture, AGENT_TEXTURE_SIZE);
					gloves[item] = { model: await pack.addFile(`gloves/${item}.glb`, exported.glb, true) };
					return true;
				})();
				pendingGloves.set(item, promise);
			}
			return promise;
		};
		const glovePaint = async (item: number, paint: number) => {
			const kit = kits.get(paint);
			if (!kit || !(await gloveModel(item)) || paints[paint]) return;
			const recipe = kit.composite ? await blocks.read(kit.composite) : null;
			const composite = recipe ? compositePaint(recipe) : null;
			const candidates = [kit.vmat, composite?.material, `gloves/paints/${kit.name}.vmat`].filter(
				(path): path is string => Boolean(path) && vpk.has(`${path}_c`)
			);
			const data = candidates[0] ? await blocks.read(candidates[0]) : null;
			if (!data) {
				log(`  no material for glove paint ${kit.name}`);
				return;
			}
			const params = materialParams(data);
			if (!params.shader.includes('customglove') || params.shader.includes('preview')) {
				log(`  glove paint ${kit.name} uses ${params.shader}, not supported yet`);
				return;
			}
			const picked = Object.fromEntries(
				Object.entries(params.textures).filter(([name]) => name in GLOVE_TEXTURES)
			);
			for (const [name, texture] of Object.entries(picked))
				want(texture, GLOVE_TEXTURES[name] === 'mask' ? GLOVE_MASK_SIZE : DETAIL_SIZE);
			paints[paint] = {
				name: kit.name,
				style: 0,
				legacy: false,
				wear: kit.wear,
				glove: true,
				...gloveParams(params),
				textures: picked
			};
		};

		const weaponPaints = cosmetics.paints.filter(({ item }) => !isGlovesItem(item));
		const used = [...new Set(weaponPaints.map(({ paint }) => paint))].flatMap((paint) => {
			const kit = kits.get(paint);
			return kit ? [kit] : [];
		});
		const recipePath = (kit: PaintKit) =>
			kit.composite ?? `weapons/paints/legacy/${kit.name}.vcompmat`;
		await blocks.prefetch(used.map(recipePath));
		const recipes = new Map<string, ReturnType<typeof compositePaint>>();
		const rolls = new Map<string, PaintRoll[]>();
		for (const kit of used) {
			const recipe = await blocks.read(recipePath(kit));
			rolls.set(kit.name, await recipeRolls(blocks, recipe));
			recipes.set(
				kit.name,
				recipe ? compositePaint(recipe) : { material: null, overrides: materialParams({}) }
			);
		}
		const basePath = (kit: PaintKit) =>
			recipes.get(kit.name)?.material ??
			`materials/models/weapons/customization/paints/vmats/${kit.name}.vmat`;
		await blocks.prefetch(used.map(basePath));

		let done = 0;
		await forEachLimit(cosmetics.paints, 2, async ({ item, paint }) => {
			if (isGlovesItem(item)) {
				await glovePaint(item, paint);
				return;
			}
			const key = itemWeaponKey(item);
			const kit = kits.get(paint);
			if (!key || !kit) {
				log(`  skipped paint ${paint} on item ${item}`);
				return;
			}
			if (!(await weapon(key, kit.legacy))) return;
			if (paints[paint]) return;
			const overrides = recipes.get(kit.name)?.overrides ?? materialParams({});
			const base = await blocks.read(basePath(kit));
			if (!base) {
				log(`  no material for ${kit.name}`);
				return;
			}
			const params = mergeParams(materialParams(base), overrides);
			const picked = Object.fromEntries(
				Object.entries(params.textures).filter(([name]) => PAINT_TEXTURES.has(name))
			);
			for (const [name, texture] of Object.entries(picked))
				want(texture, name === 'g_tPattern' || name === 'g_tNormal' ? patternSize : DETAIL_SIZE);
			paints[paint] = {
				name: kit.name,
				style:
					params.ints.F_PAINT_STYLE !== undefined ? params.ints.F_PAINT_STYLE + 1 : kit.style || 7,
				legacy: kit.legacy,
				wear: kit.wear,
				...trimParams(params),
				...(rolls.get(kit.name)?.length ? { rolls: rolls.get(kit.name) } : {}),
				textures: picked
			};
			done++;
			if (cosmetics.paints.length < 100 || done % 100 === 0)
				log(`skins: ${done} paint kits (${kit.name}, style ${paints[paint]!.style})`);
		});

		const pngDir = join(options.workDir, 'png');
		const pngPath = (path: string) => join(pngDir, path.replace(/\.vtex$/, '.png'));
		const resampledDir = join(options.workDir, 'resampled');
		const cachePath = (path: string, size: number) =>
			join(resampledDir, `${path.replaceAll('/', '__')}.${size}.cstx`);
		await mkdir(resampledDir, { recursive: true });
		const packedDir = join(options.workDir, 'packed');
		const scanPath = join(options.workDir, 'scan.json');
		const scan: Record<string, PackTexture | null> = existsSync(scanPath)
			? JSON.parse(await readFile(scanPath, 'utf8'))
			: {};
		const oversized: { path: string; size: number; source: PackTexture }[] = [];
		let scanned = 0;
		for (const [path, size] of textures) {
			if (
				!vpk.has(`${path}_c`) ||
				existsSync(cachePath(path, size)) ||
				existsSync(join(packedDir, `${path.replaceAll('/', '__')}.textures.${size}.json`))
			)
				continue;
			const id = `${path}|${size}`;
			if (!(id in scan)) {
				const parsed = parseVtex(await vpk.read(`${path}_c`));
				const limited = parsed.texture ? limitTextureSize(parsed.texture, size) : null;
				scan[id] =
					parsed.texture && limited && Math.max(limited.width, limited.height) > size
						? { ...parsed.texture, mipData: [] }
						: null;
				if (++scanned % 200 === 0) await writeFile(scanPath, JSON.stringify(scan));
			}
			const source = scan[id];
			if (source) oversized.push({ path, size, source });
		}
		await writeFile(scanPath, JSON.stringify(scan));
		if (oversized.length) log(`skins: shrinking ${oversized.length} textures`);
		pool = new ResamplePool();
		const workers = pool;
		for (let i = 0; i < oversized.length; i += 24) {
			const batch = oversized.slice(i, i + 24);
			await run(tools.vrf, [
				'-i',
				vpkPath,
				'-f',
				batch.map(({ path }) => `${path}_c`).join(','),
				'-d',
				'-o',
				pngDir + sep
			]).catch((error: Error) => log(`  decoding failed: ${error.message.split('\n')[0]}`));
			await Promise.all(
				batch.map(async ({ path, size, source }) => {
					const png = pngPath(path);
					if (!existsSync(png)) return;
					const result = await workers
						.resample(source, await readFile(png), size)
						.catch(() => null);
					if (result) await writeFile(cachePath(path, size), encodePackTexture(result));
					await rm(png, { force: true });
				})
			);
			if (oversized.length > 48)
				log(`  ${Math.min(i + 24, oversized.length)}/${oversized.length} shrunk`);
		}
		pack.textureCache = packedDir;
		await mkdir(pack.textureCache, { recursive: true });
		pack.resampler = async (path, _source, maxSize) => {
			const cached = cachePath(path, maxSize);
			return existsSync(cached) ? decodePackTexture(await readFile(cached)) : null;
		};

		log(`skins: packing ${textures.size} textures`);
		let packed = 0;
		await forEachLimit(
			[...textures].sort(([a], [b]) => a.localeCompare(b)),
			8,
			async ([texture, size]) => {
				await pack.addTexture(texture, [vpk], 'textures', size);
				await rm(cachePath(texture, size), { force: true });
				if (++packed % 250 === 0) log(`  ${packed}/${textures.size} textures`);
			}
		);

		const manifest: SkinsPackManifest = {
			version: SKINS_PACK_VERSION,
			exportedAt: new Date().toISOString(),
			build: gameBuild(csgo),
			tools: { ...tools.versions, exporter: EXPORTER_VERSION },
			agents,
			weapons,
			paints,
			gloves,
			textures: pack.textures
		};
		await pack.addFile(
			SKINS_PACK_MANIFEST,
			new TextEncoder().encode(JSON.stringify(manifest)),
			false
		);
		await pack.close();
		log(`Moving the pack to ${packPath}`);
		await mkdir(dirname(packPath), { recursive: true });
		await rename(partPath, packPath).catch(async (error: NodeJS.ErrnoException) => {
			if (error.code !== 'EXDEV') throw error;
			await copyFile(partPath, packPath);
		});
		return { pack: packPath, bytes: pack.bytes };
	} catch (error) {
		await pack.close().catch(() => {});
		throw error;
	} finally {
		await pool?.close();
		await vpk.close();
		if (!options.keepWork && !options.reuseWork)
			await rm(options.workDir, { recursive: true, force: true });
	}
}

export async function patchSkinRolls(options: {
	csgo: string;
	pack: string;
	outDir: string;
	workDir: string;
	tools: Tools;
	log: (message: string) => void;
}): Promise<{ pack: string; patched: number }> {
	const { csgo, log } = options;
	const vpkPath = join(csgo, 'pak01_dir.vpk');
	const vpk = await Vpk.open(vpkPath);
	const vrf = new Vrf(options.tools.vrf, join(csgo, 'gameinfo.gi'));
	const blocks = new Blocks(vrf, vpkPath, join(options.workDir, 'blocks'), log);
	const kits = paintKits(new TextDecoder().decode(await vpk.read('scripts/items/items_game.txt')));
	const source = await openZipFile(options.pack);
	try {
		const manifestEntry = source.entries.get(SKINS_PACK_MANIFEST);
		if (!manifestEntry) throw new Error(`${options.pack} is not a skins pack`);
		const manifest = JSON.parse(
			new TextDecoder().decode(await source.read(manifestEntry))
		) as SkinsPackManifest;
		const recipePath = (kit: PaintKit) =>
			kit.composite ?? `weapons/paints/legacy/${kit.name}.vcompmat`;
		const targets = Object.entries(manifest.paints).flatMap(([id, paint]) => {
			const kit = kits.get(Number(id));
			return kit && !paint.glove ? [{ paint, kit }] : [];
		});
		await blocks.prefetch(targets.map(({ kit }) => recipePath(kit)));
		const includes = new Set<string>();
		for (const { kit } of targets)
			for (const path of compositeRolls(await blocks.read(recipePath(kit))).includes)
				includes.add(path);
		await blocks.prefetch([...includes]);
		let patched = 0;
		for (const { paint, kit } of targets) {
			const rolls = await recipeRolls(blocks, await blocks.read(recipePath(kit)));
			if (rolls.length) {
				paint.rolls = rolls;
				patched++;
			} else delete paint.rolls;
		}
		await mkdir(options.outDir, { recursive: true });
		const out = join(options.outDir, `${SKINS_PACK_NAME}-patched.zip`);
		const writer = new ZipWriter(`${out}.partial`);
		await writer.add(SKINS_PACK_MANIFEST, new TextEncoder().encode(JSON.stringify(manifest)), true);
		for (const entry of source.entries.values())
			if (entry.name !== SKINS_PACK_MANIFEST)
				await writer.add(entry.name, await source.read(entry), entry.method !== 0);
		await writer.close();
		await rename(`${out}.partial`, out);
		log(`skins: seed rolls for ${patched} of ${targets.length} paint kits`);
		return { pack: out, patched };
	} finally {
		await source.close();
	}
}
