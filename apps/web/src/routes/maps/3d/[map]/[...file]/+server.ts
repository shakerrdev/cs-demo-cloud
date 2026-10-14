import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { packFilePath, packFileSize } from '@cs-demo-cloud/shared';
import { storage } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const path = packFilePath(storage, params.map, params.file);
	if (!path || params.file === 'installed.json') error(404, 'Not found');
	const size = await packFileSize(path);
	if (size === null) error(404, 'Not found');

	const gzip = path.endsWith('.gz');
	const name = gzip ? path.slice(0, -3) : path;
	const headers: Record<string, string> = {
		'content-type': name.endsWith('.json') ? 'application/json' : 'application/octet-stream',
		'content-length': String(size),
		'cache-control': url.searchParams.has('v')
			? 'private, max-age=31536000, immutable'
			: 'private, no-cache'
	};
	if (gzip) headers['content-encoding'] = 'gzip';

	const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
	return new Response(stream, { headers });
};
