import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { decodePng, encodeImage, halve, resampleTexture } from './resample.ts';

function crc32(bytes: Uint8Array): number {
	let crc = -1;
	for (const byte of bytes) {
		crc ^= byte;
		for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return (crc ^ -1) >>> 0;
}

function png(width: number, height: number, pixel: (x: number, y: number) => number[], filter = 0) {
	const rows: number[] = [];
	for (let y = 0; y < height; y++) {
		rows.push(filter);
		for (let x = 0; x < width; x++) {
			const value = pixel(x, y);
			const left = x > 0 ? pixel(x - 1, y) : [0, 0, 0, 0];
			for (let c = 0; c < 4; c++)
				rows.push(filter === 1 ? (value[c]! - left[c]! + 256) & 255 : value[c]!);
		}
	}
	const chunk = (name: string, data: Uint8Array) => {
		const out = new Uint8Array(12 + data.length);
		const view = new DataView(out.buffer);
		view.setUint32(0, data.length);
		out.set(new TextEncoder().encode(name), 4);
		out.set(data, 8);
		view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
		return out;
	};
	const header = new Uint8Array(13);
	new DataView(header.buffer).setUint32(0, width);
	new DataView(header.buffer).setUint32(4, height);
	header.set([8, 6, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(Buffer.from(rows))),
		chunk('IEND', new Uint8Array())
	]);
}

function decodeBc1Block(block: Uint8Array): number[][] {
	const c0 = block[0]! | (block[1]! << 8);
	const c1 = block[2]! | (block[3]! << 8);
	const rgb = (c: number) => [
		((c >> 11) & 31) * 8.2258,
		((c >> 5) & 63) * 4.0476,
		(c & 31) * 8.2258
	];
	const p0 = rgb(c0);
	const p1 = rgb(c1);
	const palette = [
		p0,
		p1,
		p0.map((v, i) => (2 * v + p1[i]!) / 3),
		p0.map((v, i) => (v + 2 * p1[i]!) / 3)
	];
	const bits = block[4]! | (block[5]! << 8) | (block[6]! << 16) | (block[7]! << 24);
	return Array.from({ length: 16 }, (_, i) => palette[(bits >>> (i * 2)) & 3]!);
}

test('decodes PNGs with filters', () => {
	const pixel = (x: number, y: number) => [x * 16, y * 16, 128, 255];
	for (const filter of [0, 1]) {
		const image = decodePng(png(8, 4, pixel, filter));
		assert.equal(image.width, 8);
		assert.equal(image.height, 4);
		assert.deepEqual(
			[...image.rgba.subarray((2 * 8 + 3) * 4, (2 * 8 + 3) * 4 + 4)],
			[48, 32, 128, 255]
		);
	}
});

test('halves images and encodes close BC1 blocks', () => {
	const image = decodePng(png(4, 4, (x, y) => [x * 40 + y * 10, 100, x * 40 + y * 10, 255]));
	assert.deepEqual([...halve(image).rgba.subarray(0, 4)], [25, 100, 25, 255]);
	const decoded = decodeBc1Block(encodeImage(image, 'bc1'));
	for (let i = 0; i < 16; i++) {
		const source = image.rgba.subarray(i * 4, i * 4 + 3);
		for (let c = 0; c < 3; c++) assert.ok(Math.abs(decoded[i]![c]! - source[c]!) < 24);
	}
});

test('resamples single-mip textures with a full mip chain', () => {
	const source = {
		width: 16,
		height: 16,
		depth: 1,
		faces: 1 as const,
		mips: 1,
		format: 'bc7' as const,
		flags: 0,
		mipData: [new Uint8Array(256)]
	};
	const result = resampleTexture(
		source,
		png(16, 16, (x) => [x * 16, 0, 0, x < 8 ? 255 : 0]),
		8
	)!;
	assert.equal(result.format, 'bc3');
	assert.equal(result.width, 8);
	assert.equal(result.mips, 4);
	assert.deepEqual(
		result.mipData.map((mip) => mip.length),
		[64, 16, 16, 16]
	);
});
