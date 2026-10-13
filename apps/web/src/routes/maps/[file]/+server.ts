import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { storage } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const match = /^([a-z0-9_]+?)(_lower)?\.png$/.exec(params.file);
	if (!match) error(404, 'Radar not found');

	const file = await readFile(storage.radarPath(match[1]!, Boolean(match[2]))).catch(() => null);
	if (!file) error(404, 'Radar not found');

	return new Response(file, {
		headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }
	});
};
