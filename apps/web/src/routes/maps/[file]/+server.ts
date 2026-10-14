import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { MAP_MESH_VERSION } from '@cs-demo-cloud/replay';
import { storage } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const radar = /^([a-z0-9_]+?)(_lower)?\.png$/.exec(params.file);
	if (radar) {
		const file = await readFile(storage.radarPath(radar[1]!, Boolean(radar[2]))).catch(() => null);
		if (!file) error(404, 'Radar not found');
		return new Response(file, {
			headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }
		});
	}

	const mesh = /^([a-z0-9_]+)\.mesh$/.exec(params.file);
	if (mesh) {
		const file = await readFile(storage.mapMeshPath(mesh[1]!, MAP_MESH_VERSION)).catch(() => null);
		if (!file) error(404, '3D map not found');
		return new Response(file, {
			headers: {
				'content-type': 'application/octet-stream',
				'content-encoding': 'gzip',
				'cache-control': 'public, max-age=604800'
			}
		});
	}

	error(404, 'Not found');
};
