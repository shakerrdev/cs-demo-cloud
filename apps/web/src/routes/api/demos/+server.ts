import { error, json } from '@sveltejs/kit';
import type { ReadableStream } from 'node:stream/web';
import { registerDemo } from '@cs-demo-cloud/db';
import { UnsupportedDemoError, receiveDemo } from '@cs-demo-cloud/shared';
import { db } from '#lib/server/db.ts';
import { storage } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!request.body) error(400, 'The upload was empty');

	const fileName =
		decodeURIComponent(request.headers.get('x-file-name') ?? '').trim() || 'demo.dem';
	const modified = Number(request.headers.get('x-file-modified'));

	try {
		const incoming = await receiveDemo(
			storage,
			request.body as unknown as ReadableStream<Uint8Array>
		);
		const { demo, duplicate } = await registerDemo(db, storage, incoming, {
			fileName,
			fileModifiedAt: Number.isFinite(modified) && modified > 0 ? new Date(modified) : null,
			source: locals.apiToken ? 'extension' : 'upload',
			uploadedBy: locals.user?.id ?? null
		});
		return json({ id: demo.id, duplicate }, { status: duplicate ? 200 : 201 });
	} catch (cause) {
		if (cause instanceof UnsupportedDemoError) error(415, cause.message);
		throw cause;
	}
};
