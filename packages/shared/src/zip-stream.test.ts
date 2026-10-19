import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { uniqueZipNames, zipStream, zipStreamSize, type ZipStreamEntry } from './zip-stream.ts';

const dir = await mkdtemp(join(tmpdir(), 'zip-stream-'));
after(() => rm(dir, { recursive: true, force: true }));

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

async function entry(name: string, data: Buffer): Promise<ZipStreamEntry> {
	const path = join(dir, `${Math.random().toString(36).slice(2)}.bin`);
	await writeFile(path, data);
	return { name, path, size: data.length, modified: new Date(2026, 9, 19, 14, 5, 30) };
}

const readWithPython = `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    print(json.dumps([[i.filename, i.file_size, z.read(i).hex(), list(i.date_time)] for i in z.infolist()]))
`;

test('writes a zip that other tools read, with the size known up front', async () => {
	const files = [
		await entry('match.dem.bz2', Buffer.from('BZh91AY&SY demo bytes')),
		await entry('müller ü.dem', Buffer.from(Array.from({ length: 200_000 }, (_, i) => i & 0xff))),
		await entry('empty.dem', Buffer.alloc(0))
	];
	const zip = await collect(zipStream(files));
	assert.equal(zip.length, zipStreamSize(files));

	const path = join(dir, 'out.zip');
	await writeFile(path, zip);
	const listed = JSON.parse(execFileSync('python3', ['-c', readWithPython, path]).toString()) as [
		string,
		number,
		string,
		number[]
	][];
	assert.deepEqual(
		listed.map(([name, size]) => [name, size]),
		files.map((file) => [file.name, file.size])
	);
	assert.equal(listed[0]![2], Buffer.from('BZh91AY&SY demo bytes').toString('hex'));
	assert.equal(Buffer.from(listed[1]![2], 'hex').length, 200_000);
	assert.deepEqual(listed[0]![3], [2026, 10, 19, 14, 5, 30]);
});

test('writes an empty zip', async () => {
	const zip = await collect(zipStream([]));
	assert.equal(zip.length, zipStreamSize([]));
	const path = join(dir, 'empty.zip');
	await writeFile(path, zip);
	assert.equal(execFileSync('python3', ['-c', readWithPython, path]).toString().trim(), '[]');
});

test('fails when a file changes size during the export', async () => {
	const file = await entry('a.dem', Buffer.alloc(10));
	await assert.rejects(collect(zipStream([{ ...file, size: 20 }])), /changed size/);
});

test('numbers duplicate names before the extension', () => {
	assert.deepEqual(uniqueZipNames(['a.dem.bz2', 'A.dem.bz2', 'a.dem.bz2', 'b.dem', 'b.dem']), [
		'a.dem.bz2',
		'A (2).dem.bz2',
		'a (3).dem.bz2',
		'b.dem',
		'b (2).dem'
	]);
});
