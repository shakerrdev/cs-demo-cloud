import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { openZipFile } from './zip.ts';
import type { Storage } from './storage.ts';

const MANIFEST = 'map.json';
const PLAYERS_MANIFEST = 'players.json';
const PLAYERS_VERSION = 1;
const SKINS_MANIFEST = 'skins.json';
const SKINS_VERSION = 1;
const SOUNDS_MANIFEST = 'sounds.json';
const SOUNDS_VERSION = 1;
const AGENTS_MANIFEST = 'agents.json';
const AGENTS_VERSION = 1;
const INFO = 'installed.json';
const PACK_VERSION = 1;
const MAP_NAME = /^[a-z0-9_]{1,64}$/;
const ENTRY_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/;

export interface InstalledMapPack {
	map: string;
	version: string;
	exportedAt: string;
	build: string | null;
	bytes: number;
	files: number;
	installedAt: string;
}

export class MapPackError extends Error {}

export const PLAYER_PACK = 'players';
export const SKINS_PACK = 'skins';
export const SOUNDS_PACK = 'sounds';
export const AGENTS_PACK = 'agents';
const SPECIAL_PACKS = new Set([PLAYER_PACK, SKINS_PACK, SOUNDS_PACK, AGENTS_PACK]);

export function isSpecialPack(name: string): boolean {
	return SPECIAL_PACKS.has(name);
}

export function isMapName(value: string): boolean {
	return MAP_NAME.test(value);
}

export function isPackFileName(value: string): boolean {
	return ENTRY_NAME.test(value) && !value.split('/').some((part) => part === '..' || part === '');
}

export function mapPacksDir(storage: Storage): string {
	return join(storage.dataDir, 'maps', '3d');
}

export function mapPackDir(storage: Storage, map: string): string {
	if (!isMapName(map)) throw new MapPackError('Bad map name');
	return join(mapPacksDir(storage), map);
}

export function packFilePath(storage: Storage, map: string, file: string): string | null {
	if (!isMapName(map) || !isPackFileName(file)) return null;
	const root = mapPackDir(storage, map);
	const path = join(root, ...file.split('/'));
	return path.startsWith(root + sep) ? path : null;
}

function versionOf(exportedAt: string, installedAt: string): string {
	const time = Date.parse(exportedAt) || 0;
	const installed = Date.parse(installedAt) || 0;
	return `${time.toString(36)}${installed.toString(36)}`;
}

export async function readMapPack(storage: Storage, map: string): Promise<InstalledMapPack | null> {
	if (!isMapName(map)) return null;
	try {
		return JSON.parse(
			await readFile(join(mapPackDir(storage, map), INFO), 'utf8')
		) as InstalledMapPack;
	} catch {
		return null;
	}
}

export async function listMapPacks(storage: Storage): Promise<InstalledMapPack[]> {
	const root = mapPacksDir(storage);
	if (!existsSync(root)) return [];
	const packs: InstalledMapPack[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || !isMapName(entry.name)) continue;
		const pack = await readMapPack(storage, entry.name);
		if (pack) packs.push(pack);
	}
	return packs.sort((a, b) => a.map.localeCompare(b.map));
}

export async function removeMapPack(storage: Storage, map: string): Promise<boolean> {
	const dir = mapPackDir(storage, map);
	if (!existsSync(dir)) return false;
	const trash = join(mapPacksDir(storage), `.removed-${randomUUID()}`);
	await rename(dir, trash);
	await rm(trash, { recursive: true, force: true });
	return true;
}

type Json = Record<string, unknown>;
type TextureMap = Record<string, { file?: unknown; low?: { file?: unknown } }>;

interface PackSource {
	names(): string[];
	read(name: string): Promise<Uint8Array>;
}

interface PackPart {
	name: string;
	manifestFile: string;
	manifest: Json;
	files: Set<string>;
	required: unknown[];
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const record = (value: unknown): Json =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const strings = (values: unknown[]): string[] =>
	values.filter((value): value is string => typeof value === 'string');

function textureFiles(textures: TextureMap, keys: Iterable<string>): string[] {
	const files: unknown[] = [];
	for (const key of keys) {
		const texture = textures[key];
		if (!texture) continue;
		files.push(texture.file);
		if (texture.low) files.push(texture.low.file);
	}
	return strings(files);
}

function pick<T>(map: Record<string, T>, keys: Iterable<string>): Record<string, T> {
	const out: Record<string, T> = {};
	for (const key of keys) if (key in map) out[key] = map[key]!;
	return out;
}

export function glbTextureRefs(glb: Uint8Array): string[] {
	if (glb.length < 20) return [];
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	if (view.getUint32(0, true) !== 0x46546c67) return [];
	const length = view.getUint32(12, true);
	const json = JSON.parse(decode(glb.subarray(20, 20 + length))) as {
		materials?: { extras?: { vmat?: { TextureParams?: Record<string, unknown> } } }[];
	};
	return strings(
		(json.materials ?? []).flatMap((material) =>
			Object.values(material.extras?.vmat?.TextureParams ?? {})
		)
	);
}

function checkVersion(manifest: Json, version: number, what: string) {
	if (manifest.version !== version)
		throw new MapPackError(
			`Unsupported ${what} version ${String(manifest.version)}; export it again`
		);
}

async function playersParts(source: PackSource, manifest: Json): Promise<PackPart[]> {
	checkVersion(manifest, PLAYERS_VERSION, 'player pack');
	if (!manifest.characters || !manifest.animations)
		throw new MapPackError('The player pack has no characters or animations');
	const { sounds, ...players } = manifest;
	const soundMap = record(sounds) as Record<string, { files?: unknown[] }>;
	const soundFiles = new Set(
		strings(Object.values(soundMap).flatMap((sound) => sound.files ?? []))
	);
	const rest = source
		.names()
		.filter((name) => !soundFiles.has(name) && name !== PLAYERS_MANIFEST && name !== INFO);
	const textures = record(players.textures) as TextureMap;
	const parts: PackPart[] = [
		{
			name: PLAYER_PACK,
			manifestFile: PLAYERS_MANIFEST,
			manifest: players,
			files: new Set(rest),
			required: [
				...Object.values(record(players.characters)),
				players.animations,
				...Object.values(record(players.weapons)).map((weapon) => record(weapon).model),
				...((record(players.viewmodel).animations as unknown[] | undefined) ?? []),
				...textureFiles(textures, Object.keys(textures))
			]
		}
	];
	if (soundFiles.size) parts.push(soundsPart(manifest, soundMap, soundFiles));
	return parts;
}

function soundsPart(
	manifest: Json,
	sounds: Record<string, { files?: unknown[] }>,
	files: Set<string>
): PackPart {
	return {
		name: SOUNDS_PACK,
		manifestFile: SOUNDS_MANIFEST,
		manifest: {
			version: SOUNDS_VERSION,
			exportedAt: manifest.exportedAt,
			build: manifest.build ?? null,
			tools: manifest.tools ?? {},
			sounds
		},
		files,
		required: [...files]
	};
}

async function skinsParts(source: PackSource, manifest: Json): Promise<PackPart[]> {
	checkVersion(manifest, SKINS_VERSION, 'skins pack');
	const textures = record(manifest.textures) as TextureMap;
	const agents = record(manifest.agents) as Record<string, unknown>;
	const agentModels = new Set(strings(Object.values(agents)));
	const agentTextures = new Set<string>();
	for (const model of agentModels)
		for (const ref of glbTextureRefs(await source.read(model)))
			if (ref in textures) agentTextures.add(ref);

	const weapons = record(manifest.weapons) as Record<string, { model?: unknown; textures?: Json }>;
	const paints = record(manifest.paints) as Record<string, { textures?: Json }>;
	const gloves = record(manifest.gloves) as Record<string, { model?: unknown }>;
	const skinModels = strings([
		...Object.values(weapons).map((weapon) => weapon.model),
		...Object.values(gloves).map((glove) => glove.model)
	]);
	const skinTextures = new Set(
		strings([
			...Object.values(weapons).flatMap((weapon) => Object.values(weapon.textures ?? {})),
			...Object.values(paints).flatMap((paint) => Object.values(paint.textures ?? {}))
		])
	);
	for (const model of skinModels)
		for (const ref of glbTextureRefs(await source.read(model))) skinTextures.add(ref);
	const agentOnly = [...agentTextures].filter((key) => !skinTextures.has(key));
	const keptTextures = Object.keys(textures).filter((key) => !agentOnly.includes(key));

	const skinFiles = new Set(textureFiles(textures, keptTextures));
	const agentFiles = new Set([...agentModels, ...textureFiles(textures, agentTextures)]);
	const rest = source
		.names()
		.filter(
			(name) =>
				name !== SKINS_MANIFEST && name !== INFO && (skinFiles.has(name) || !agentFiles.has(name))
		);
	const skins = { ...manifest, agents: {}, textures: pick(textures, keptTextures) };
	const parts: PackPart[] = [
		{
			name: SKINS_PACK,
			manifestFile: SKINS_MANIFEST,
			manifest: skins,
			files: new Set(rest),
			required: [...skinModels, ...skinFiles]
		}
	];
	if (agentModels.size)
		parts.push(agentsPart(manifest, agents, pick(textures, agentTextures), agentFiles));
	return parts;
}

function agentsPart(
	manifest: Json,
	agents: Record<string, unknown>,
	textures: TextureMap,
	files: Set<string>
): PackPart {
	return {
		name: AGENTS_PACK,
		manifestFile: AGENTS_MANIFEST,
		manifest: {
			version: AGENTS_VERSION,
			exportedAt: manifest.exportedAt,
			build: manifest.build ?? null,
			tools: manifest.tools ?? {},
			agents,
			textures
		},
		files,
		required: [...files]
	};
}

function mapPart(source: PackSource, map: Json): PackPart {
	checkVersion(map, PACK_VERSION, 'map pack');
	if (typeof map.map !== 'string' || !isMapName(map.map) || SPECIAL_PACKS.has(map.map))
		throw new MapPackError('The pack has no valid map name');
	const worlds = Array.isArray(map.worlds) ? (map.worlds as { model?: unknown }[]) : [];
	if (!worlds.length) throw new MapPackError('The pack has no worlds');
	const textures = record(map.textures) as TextureMap;
	return {
		name: map.map,
		manifestFile: MANIFEST,
		manifest: map,
		files: new Set(source.names().filter((name) => name !== MANIFEST && name !== INFO)),
		required: [
			...worlds.map((world) => world.model),
			...textureFiles(textures, Object.keys(textures))
		]
	};
}

async function packParts(source: PackSource): Promise<PackPart[]> {
	const names = new Set(source.names());
	const json = async (name: string) => record(JSON.parse(decode(await source.read(name))));
	if (names.has(SKINS_MANIFEST)) return skinsParts(source, await json(SKINS_MANIFEST));
	if (names.has(PLAYERS_MANIFEST)) return playersParts(source, await json(PLAYERS_MANIFEST));
	if (names.has(SOUNDS_MANIFEST)) {
		const manifest = await json(SOUNDS_MANIFEST);
		checkVersion(manifest, SOUNDS_VERSION, 'sounds pack');
		const sounds = record(manifest.sounds) as Record<string, { files?: unknown[] }>;
		const files = new Set(strings(Object.values(sounds).flatMap((sound) => sound.files ?? [])));
		return [soundsPart(manifest, sounds, files)];
	}
	if (names.has(AGENTS_MANIFEST)) {
		const manifest = await json(AGENTS_MANIFEST);
		checkVersion(manifest, AGENTS_VERSION, 'agents pack');
		const agents = record(manifest.agents);
		const textures = record(manifest.textures) as TextureMap;
		const files = new Set([
			...strings(Object.values(agents)),
			...textureFiles(textures, Object.keys(textures))
		]);
		return [agentsPart(manifest, agents, textures, files)];
	}
	if (names.has(MANIFEST)) return [mapPart(source, await json(MANIFEST))];
	throw new MapPackError('The zip has no map.json, so it is not a map pack');
}

async function installParts(storage: Storage, source: PackSource): Promise<InstalledMapPack[]> {
	const parts = await packParts(source);
	const names = new Set(source.names());
	for (const part of parts)
		for (const file of part.required)
			if (typeof file !== 'string' || !names.has(file))
				throw new MapPackError(`The pack is missing ${String(file)}`);

	const root = mapPacksDir(storage);
	const staged: { part: PackPart; dir: string; info: InstalledMapPack }[] = [];
	try {
		for (const part of parts) {
			const dir = join(root, `.incoming-${randomUUID()}`);
			staged.push({ part, dir, info: null as unknown as InstalledMapPack });
			let bytes = 0;
			for (const name of part.files) {
				if (name.endsWith('/')) continue;
				if (!isPackFileName(name)) throw new MapPackError(`Unexpected file ${name}`);
				const target = join(dir, ...name.split('/'));
				await mkdir(dirname(target), { recursive: true });
				const data = await source.read(name);
				await writeFile(target, data);
				bytes += data.length;
			}
			const manifestText = JSON.stringify(part.manifest);
			await mkdir(dir, { recursive: true });
			await writeFile(join(dir, part.manifestFile), manifestText);
			const installedAt = new Date().toISOString();
			const exportedAt =
				typeof part.manifest.exportedAt === 'string' ? part.manifest.exportedAt : installedAt;
			const info: InstalledMapPack = {
				map: part.name,
				version: versionOf(exportedAt, installedAt),
				exportedAt,
				build: typeof part.manifest.build === 'string' ? part.manifest.build : null,
				bytes: bytes + manifestText.length,
				files: part.files.size + 1,
				installedAt
			};
			await writeFile(join(dir, INFO), JSON.stringify(info));
			staged[staged.length - 1]!.info = info;
		}
		for (const { part, dir } of staged) {
			const target = mapPackDir(storage, part.name);
			const old = join(root, `.replaced-${randomUUID()}`);
			const hadOld = existsSync(target);
			if (hadOld) await rename(target, old);
			await rename(dir, target);
			if (hadOld) await rm(old, { recursive: true, force: true });
		}
		return staged.map(({ info }) => info);
	} catch (error) {
		for (const { dir } of staged) await rm(dir, { recursive: true, force: true });
		throw error;
	}
}

export async function installMapPack(
	storage: Storage,
	zipPath: string
): Promise<InstalledMapPack[]> {
	let zip;
	try {
		zip = await openZipFile(zipPath);
	} catch {
		throw new MapPackError('Not a map pack (expected the .zip from the map exporter)');
	}
	try {
		const entries = zip.entries;
		return await installParts(storage, {
			names: () => [...entries.keys()].filter((name) => !name.endsWith('/')),
			read: (name) => {
				const entry = entries.get(name);
				if (!entry) throw new MapPackError(`The pack is missing ${name}`);
				return zip.read(entry);
			}
		});
	} finally {
		await zip.close();
	}
}

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
		const name = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...(await listFiles(dir, name)));
		else out.push(name);
	}
	return out;
}

export async function splitCombinedPacks(storage: Storage): Promise<InstalledMapPack[]> {
	const split: InstalledMapPack[] = [];
	for (const [name, manifestFile, key] of [
		[PLAYER_PACK, PLAYERS_MANIFEST, 'sounds'],
		[SKINS_PACK, SKINS_MANIFEST, 'agents']
	] as const) {
		const dir = mapPackDir(storage, name);
		const manifestPath = join(dir, manifestFile);
		if (!existsSync(manifestPath)) continue;
		const manifest = record(JSON.parse(await readFile(manifestPath, 'utf8')));
		if (!Object.keys(record(manifest[key])).length) continue;
		const files = (await listFiles(dir)).filter((file) => file !== INFO);
		split.push(
			...(await installParts(storage, {
				names: () => files,
				read: (file) => readFile(join(dir, ...file.split('/')))
			}))
		);
	}
	return split;
}

export async function packFileSize(path: string): Promise<number | null> {
	try {
		const info = await stat(path);
		return info.isFile() ? info.size : null;
	} catch {
		return null;
	}
}
