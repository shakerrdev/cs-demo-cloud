import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { getDemo } from '@cs-demo-cloud/db';
import { demoStream } from '@cs-demo-cloud/shared';
import { db } from '#lib/server/db.ts';
import { attachment, exportFileName } from '#lib/server/export.ts';
import { isDemoId, storage } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	if (!isDemoId(params.id)) error(404, 'Demo not found');
	const demo = getDemo(db, params.id);
	if (!demo) error(404, 'Demo not found');

	const path = storage.demoPath(demo.id, demo.format);
	const file = await stat(path).catch(() => null);
	if (!file) error(404, 'The demo file is missing on the server');

	const original = url.searchParams.has('original') || demo.format === 'dem';
	const headers: Record<string, string> = {
		'content-type': 'application/octet-stream',
		'content-disposition': attachment(exportFileName(demo.fileName, demo.format, original)),
		'cache-control': 'private, no-store'
	};
	if (original) headers['content-length'] = String(file.size);

	const stream = original ? createReadStream(path) : demoStream(path, demo.format);
	return new Response(Readable.toWeb(stream) as ReadableStream, { headers });
};
