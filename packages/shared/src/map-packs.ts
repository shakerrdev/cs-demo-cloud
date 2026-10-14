import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { openZipFile } from './zip.ts';
import type { Storage } from './storage.ts';

const MANIFEST = 'map.json';
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

interface ManifestShape {
	version?: unknown;
	map?: unknown;
	exportedAt?: unknown;
	build?: unknown;
	worlds?: { model?: unknown }[];
	textures?: Record<string, { file?: unknown }>;
}

export async function installMapPack(storage: Storage, zipPath: string): Promise<InstalledMapPack> {
	let zip;
	try {
		zip = await openZipFile(zipPath);
	} catch {
		throw new MapPackError('Not a map pack (expected the .zip from the map exporter)');
	}

	const root = mapPacksDir(storage);
	const incoming = join(root, `.incoming-${randomUUID()}`);
	try {
		const manifestEntry = zip.entries.get(MANIFEST);
		if (!manifestEntry) throw new MapPackError('The zip has no map.json, so it is not a map pack');
		const manifest = JSON.parse(
			new TextDecoder().decode(await zip.read(manifestEntry))
		) as ManifestShape;
		if (manifest.version !== PACK_VERSION)
			throw new MapPackError(
				`Unsupported map pack version ${String(manifest.version)}; export it again`
			);
		if (typeof manifest.map !== 'string' || !isMapName(manifest.map))
			throw new MapPackError('The pack has no valid map name');
		if (!Array.isArray(manifest.worlds) || !manifest.worlds.length)
			throw new MapPackError('The pack has no worlds');

		const referenced = [
			...manifest.worlds.map((world) => world.model),
			...Object.values(manifest.textures ?? {}).map((texture) => texture.file)
		];
		for (const file of referenced) {
			if (typeof file !== 'string' || !zip.entries.has(file))
				throw new MapPackError(`The pack is missing ${String(file)}`);
		}

		let bytes = 0;
		for (const entry of zip.entries.values()) {
			if (entry.name.endsWith('/')) continue;
			if (!isPackFileName(entry.name)) throw new MapPackError(`Unexpected file ${entry.name}`);
			const target = join(incoming, ...entry.name.split('/'));
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, await zip.read(entry));
			bytes += entry.size;
		}

		const installedAt = new Date().toISOString();
		const exportedAt = typeof manifest.exportedAt === 'string' ? manifest.exportedAt : installedAt;
		const info: InstalledMapPack = {
			map: manifest.map,
			version: versionOf(exportedAt, installedAt),
			exportedAt,
			build: typeof manifest.build === 'string' ? manifest.build : null,
			bytes,
			files: zip.entries.size,
			installedAt
		};
		await writeFile(join(incoming, INFO), JSON.stringify(info));

		const target = mapPackDir(storage, manifest.map);
		const old = join(root, `.replaced-${randomUUID()}`);
		const hadOld = existsSync(target);
		if (hadOld) await rename(target, old);
		await rename(incoming, target);
		if (hadOld) await rm(old, { recursive: true, force: true });
		return info;
	} catch (error) {
		await rm(incoming, { recursive: true, force: true });
		throw error;
	} finally {
		await zip.close();
	}
}

export async function packFileSize(path: string): Promise<number | null> {
	try {
		const info = await stat(path);
		return info.isFile() ? info.size : null;
	} catch {
		return null;
	}
}
