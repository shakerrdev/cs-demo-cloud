import { parentPort } from 'node:worker_threads';
import type { PackTexture } from '@cs-demo-cloud/replay';
import { resampleTexture } from './resample.ts';

parentPort!.on(
	'message',
	({
		id,
		source,
		png,
		maxSize
	}: {
		id: number;
		source: PackTexture;
		png: Uint8Array;
		maxSize: number;
	}) => {
		try {
			const result = resampleTexture(source, png, maxSize);
			parentPort!.postMessage(
				{ id, result },
				result ? result.mipData.map((mip) => mip.buffer as ArrayBuffer) : []
			);
		} catch (error) {
			parentPort!.postMessage({ id, error: (error as Error).message });
		}
	}
);
