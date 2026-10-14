import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MAP_MESH_VERSION, encodeMapMesh, quantizeMesh, readAwpyMesh } from '@cs-demo-cloud/replay';
import type { Storage } from '@cs-demo-cloud/shared';
import { openRemoteZip, type RemoteZip } from './remote-zip.ts';

export const geometryUrl =
	'https://github.com/pnxenopoulos/awpy-data/releases/download/2000930/geometry.zip';

const missing = new Set<string>();
let archive: Promise<RemoteZip> | null = null;

export type MapMeshResult = 'cached' | 'downloaded' | 'unavailable';

export async function ensureMapMesh(
	storage: Storage,
	map: string,
	fetchImpl: typeof fetch = fetch
): Promise<MapMeshResult> {
	const target = storage.mapMeshPath(map, MAP_MESH_VERSION);
	if (existsSync(target)) return 'cached';
	if (missing.has(map)) return 'unavailable';

	archive ??= openRemoteZip(geometryUrl, fetchImpl);
	const zip = await archive.catch((error: unknown) => {
		archive = null;
		throw error;
	});
	const entry = zip.entries.get(`${map}.mesh`);
	if (!entry) {
		missing.add(map);
		return 'unavailable';
	}

	const { vertices, indices } = readAwpyMesh(await zip.read(entry));
	const encoded = encodeMapMesh(quantizeMesh(vertices, indices));
	await mkdir(dirname(target), { recursive: true });
	const partial = `${target}.${process.pid}.partial`;
	await writeFile(partial, gzipSync(encoded, { level: 9 }));
	await rename(partial, target);
	return 'downloaded';
}
