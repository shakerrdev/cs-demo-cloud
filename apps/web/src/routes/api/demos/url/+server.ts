import { error, json } from '@sveltejs/kit';
import type { ReadableStream } from 'node:stream/web';
import { registerDemo } from '@cs-demo-cloud/db';
import {
	RemoteDemoError,
	UnsupportedDemoError,
	assertPublicHost,
	demoNameFromUrl,
	parseDemoUrl,
	receiveDemo
} from '@cs-demo-cloud/shared';
import { db } from '#lib/server/db.ts';
import { storage } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

const maxRedirects = 5;

async function download(start: URL): Promise<{ response: Response; url: URL }> {
	let url = start;
	for (let hop = 0; hop <= maxRedirects; hop++) {
		await assertPublicHost(url);
		const response = await fetch(url, {
			redirect: 'manual',
			signal: AbortSignal.timeout(30 * 60 * 1000)
		});
		const location = response.headers.get('location');
		if (response.status >= 300 && response.status < 400 && location) {
			await response.body?.cancel();
			url = parseDemoUrl(new URL(location, url).href);
			continue;
		}
		if (!response.ok || !response.body) {
			throw new RemoteDemoError(`The link answered ${response.status}`);
		}
		return { response, url };
	}
	throw new RemoteDemoError('Too many redirects');
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as {
		url?: unknown;
		fileName?: unknown;
	} | null;
	if (typeof body?.url !== 'string') error(400, 'Send JSON with a "url"');

	try {
		const { response, url } = await download(parseDemoUrl(body.url));
		const named = typeof body.fileName === 'string' ? body.fileName.trim() : '';
		const modified = Date.parse(response.headers.get('last-modified') ?? '');
		const incoming = await receiveDemo(
			storage,
			response.body as unknown as ReadableStream<Uint8Array>
		);
		const { demo, duplicate } = await registerDemo(db, storage, incoming, {
			fileName: named || demoNameFromUrl(url),
			fileModifiedAt: Number.isFinite(modified) ? new Date(modified) : null,
			source: 'extension',
			uploadedBy: locals.user?.id ?? null
		});
		return json({ id: demo.id, duplicate }, { status: duplicate ? 200 : 201 });
	} catch (cause) {
		if (cause instanceof UnsupportedDemoError) error(415, cause.message);
		if (cause instanceof RemoteDemoError) error(422, cause.message);
		if (cause instanceof Error && cause.name === 'TimeoutError')
			error(504, 'The download took too long');
		throw cause;
	}
};
