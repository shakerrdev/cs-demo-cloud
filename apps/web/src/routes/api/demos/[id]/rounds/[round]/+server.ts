import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { isDemoId, storage } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const round = Number(params.round);
	if (!isDemoId(params.id) || !Number.isInteger(round) || round < 1) error(404, 'Round not found');

	const file = await readFile(storage.replayPath(params.id, round)).catch(() => null);
	if (!file) error(404, 'Round not found');

	return new Response(file, {
		headers: {
			'content-type': 'application/octet-stream',
			'content-encoding': 'gzip',
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
