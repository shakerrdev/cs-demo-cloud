import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { receiveDemo, type IncomingDemo, type Storage } from '@cs-demo-cloud/shared';

export class DemoUnavailableError extends Error {}

export async function downloadDemo(
	url: string,
	storage: Storage,
	fetchImpl: typeof fetch = fetch
): Promise<IncomingDemo> {
	const response = await fetchImpl(url, { signal: AbortSignal.timeout(15 * 60_000) });
	if (response.status === 404 || response.status === 410) {
		throw new DemoUnavailableError(
			'Valve no longer has this demo (they keep them for about a month)'
		);
	}
	if (!response.ok || !response.body) throw new Error(`Demo download failed (${response.status})`);
	return receiveDemo(
		storage,
		Readable.fromWeb(response.body as unknown as ReadableStream<Uint8Array>)
	);
}
