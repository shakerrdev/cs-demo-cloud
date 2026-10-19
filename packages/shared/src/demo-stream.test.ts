import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import { demoStream } from './demo-stream.ts';
import type { DemoFormat } from './storage.ts';

const dir = await mkdtemp(join(tmpdir(), 'demo-stream-'));
after(() => rm(dir, { recursive: true, force: true }));

const demo = Buffer.concat([
	Buffer.from('PBDEMS2\0'),
	Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 31) & 0xff))
]);

const encoders: Record<DemoFormat, (data: Buffer) => Buffer> = {
	dem: (data) => data,
	gz: gzipSync,
	zst: zstdCompressSync,
	bz2: (data) => execFileSync('bzip2', ['-c'], { input: data })
};

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

for (const [format, encode] of Object.entries(encoders) as [DemoFormat, typeof encoders.dem][]) {
	test(`streams a ${format} demo as plain .dem bytes`, async () => {
		const path = join(dir, `match.${format}`);
		await writeFile(path, encode(demo));
		assert.deepEqual(await collect(demoStream(path, format)), demo);
	});
}

test('fails on a broken compressed demo', async () => {
	const path = join(dir, 'broken.gz');
	await writeFile(path, Buffer.from([0x1f, 0x8b, 1, 2, 3, 4]));
	await assert.rejects(collect(demoStream(path, 'gz')));
});
