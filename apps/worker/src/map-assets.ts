import type { Storage } from '@cs-demo-cloud/shared';
import { ensureMapMesh } from './map-meshes.ts';
import { ensureRadars } from './radars.ts';

export async function ensureMapAssets(
	storage: Storage,
	map: string,
	log: (message: string) => void
): Promise<void> {
	await ensureRadars(storage, map).catch((error: Error) =>
		log(`Radar for ${map}: ${error.message}`)
	);
	const mesh = await ensureMapMesh(storage, map).catch((error: Error) => {
		log(`3D map for ${map}: ${error.message}`);
		return null;
	});
	if (mesh === 'downloaded') log(`Downloaded the 3D map for ${map}`);
}
