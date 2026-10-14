import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { openRemoteZip } from './remote-zip.ts';

function zip(files: Record<string, Uint8Array>, comment = ''): Uint8Array {
	const encoder = new TextEncoder();
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;

	for (const [name, content] of Object.entries(files)) {
		const nameBytes = encoder.encode(name);
		const data = deflateRawSync(content);
		const crc = crc32(content);
		const local = new Uint8Array(30 + nameBytes.length + 4 + data.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(8, 8, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, data.length, true);
		lv.setUint32(22, content.length, true);
		lv.setUint16(26, nameBytes.length, true);
		lv.setUint16(28, 4, true);
		local.set(nameBytes, 30);
		local.set(data, 30 + nameBytes.length + 4);

		const central = new Uint8Array(46 + nameBytes.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(10, 8, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, data.length, true);
		cv.setUint32(24, content.length, true);
		cv.setUint16(28, nameBytes.length, true);
		cv.setUint32(42, offset, true);
		central.set(nameBytes, 46);

		locals.push(local);
		centrals.push(central);
		offset += local.length;
	}

	const commentBytes = encoder.encode(comment);
	const directorySize = centrals.reduce((sum, c) => sum + c.length, 0);
	const eocd = new Uint8Array(22 + commentBytes.length);
	const ev = new DataView(eocd.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, centrals.length, true);
	ev.setUint16(10, centrals.length, true);
	ev.setUint32(12, directorySize, true);
	ev.setUint32(16, offset, true);
	ev.setUint16(20, commentBytes.length, true);
	eocd.set(commentBytes, 22);

	const out = new Uint8Array(offset + directorySize + eocd.length);
	let at = 0;
	for (const part of [...locals, ...centrals, eocd]) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

function server(file: Uint8Array, ranges = true) {
	const requests: string[] = [];
	const fetchImpl: typeof fetch = async (_url, init) => {
		const range = new Headers(init?.headers).get('range') ?? '';
		requests.push(range);
		const match = /^bytes=(\d+)-(\d+)$/.exec(range);
		if (!ranges || !match) return new Response(file.slice(), { status: 200 });
		const start = Number(match[1]);
		const end = Math.min(Number(match[2]), file.length - 1);
		return new Response(file.slice(start, end + 1), {
			status: 206,
			headers: { 'content-range': `bytes ${start}-${end}/${file.length}` }
		});
	};
	return { fetchImpl, requests };
}

const meshA = new Uint8Array(5000).map((_, i) => (i * 31) % 251);
const meshB = new TextEncoder().encode('second file '.repeat(100));

test('reads single entries with range requests', async () => {
	const { fetchImpl, requests } = server(zip({ 'de_a.mesh': meshA, 'de_b.mesh': meshB }, 'hi'));
	const archive = await openRemoteZip('https://example.test/geometry.zip', fetchImpl);

	assert.deepEqual([...archive.entries.keys()], ['de_a.mesh', 'de_b.mesh']);
	assert.deepEqual(await archive.read(archive.entries.get('de_b.mesh')!), meshB);
	assert.deepEqual(await archive.read(archive.entries.get('de_a.mesh')!), meshA);
	assert.equal(requests.length, 6);
});

test('falls back to the whole file when ranges are ignored', async () => {
	const { fetchImpl, requests } = server(zip({ 'de_a.mesh': meshA }), false);
	const archive = await openRemoteZip('https://example.test/geometry.zip', fetchImpl);

	assert.deepEqual(await archive.read(archive.entries.get('de_a.mesh')!), meshA);
	assert.equal(requests.length, 1);
});

test('notices corrupt entries', async () => {
	const file = zip({ 'de_a.mesh': meshA });
	const entry = await openRemoteZip('https://example.test/g.zip', server(file).fetchImpl);
	const target = entry.entries.get('de_a.mesh')!;
	new DataView(file.buffer).setUint32(file.length - 22 - 46 - 9 + 16, target.crc ^ 1, true);
	const broken = await openRemoteZip('https://example.test/g.zip', server(file).fetchImpl);

	await assert.rejects(broken.read(broken.entries.get('de_a.mesh')!), /corrupt/);
});

test('rejects files that are not zips', async () => {
	const { fetchImpl } = server(new Uint8Array(100));
	await assert.rejects(openRemoteZip('https://example.test/x.zip', fetchImpl), /Not a zip file/);
});
