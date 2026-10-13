import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { detectDemoFormat, type DemoFormat, type Storage } from './storage.ts';

export interface IncomingDemo {
	path: string;
	size: number;
	sha256: string;
	format: DemoFormat;
}

export class UnsupportedDemoError extends Error {
	constructor() {
		super('Not a CS2 demo (.dem, .dem.bz2, .dem.gz or .dem.zst)');
	}
}

export async function receiveDemo(
	storage: Storage,
	body: Readable | ReadableStream<Uint8Array>
): Promise<IncomingDemo> {
	await mkdir(storage.uploadDir, { recursive: true });
	const path = join(storage.uploadDir, `${randomUUID()}.upload`);
	const hash = createHash('sha256');
	let size = 0;
	let head = new Uint8Array(0);

	const inspect = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			if (head.length < 8) head = Buffer.concat([head, chunk.subarray(0, 8 - head.length)]);
			hash.update(chunk);
			size += chunk.length;
			callback(null, chunk);
		}
	});

	try {
		const source = body instanceof Readable ? body : Readable.fromWeb(body);
		await pipeline(source, inspect, createWriteStream(path));
		const format = detectDemoFormat(head);
		if (!format) throw new UnsupportedDemoError();
		return { path, size, sha256: hash.digest('hex'), format };
	} catch (error) {
		await rm(path, { force: true });
		throw error;
	}
}
