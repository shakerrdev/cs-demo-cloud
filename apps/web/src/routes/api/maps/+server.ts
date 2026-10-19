import { error, json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { MapPackError, installMapPack, listMapPacks } from '@cs-demo-cloud/shared';
import { storage } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await listMapPacks(storage));

export const POST: RequestHandler = async ({ request, locals }) => {
	if (locals.user?.role !== 'admin') error(403, 'Only admins can add 3D maps');
	if (!request.body) error(400, 'The upload was empty');

	await mkdir(storage.uploadDir, { recursive: true });
	const path = join(storage.uploadDir, `${randomUUID()}.zip`);
	try {
		await pipeline(
			Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>),
			createWriteStream(path)
		);
		const packs = await installMapPack(storage, path);
		return json(packs, { status: 201 });
	} catch (cause) {
		if (cause instanceof MapPackError) error(400, cause.message);
		throw cause;
	} finally {
		await rm(path, { force: true });
	}
};
