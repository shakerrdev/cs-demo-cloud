import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeLz4Block } from './lz4.ts';

test('decodes literals and overlapping matches', () => {
	const input = new Uint8Array([0x32, 0x61, 0x62, 0x63, 0x02, 0x00, 0x10, 0x78]);
	const output = new Uint8Array(10);

	assert.equal(decodeLz4Block(input, output), 10);
	assert.equal(new TextDecoder().decode(output), 'abcbcbcbcx');
});

test('decodes extended literal and match lengths', () => {
	const literal = new Uint8Array(20).fill(0x41);
	const input = new Uint8Array([0xff, 5, ...literal, 0x01, 0x00, 6, 0x00]);
	const output = new Uint8Array(20 + 15 + 6 + 4);

	assert.equal(decodeLz4Block(input, output), output.length);
	assert.ok(output.every((byte) => byte === 0x41));
});

test('rejects matches before the start', () => {
	assert.throws(() => decodeLz4Block(new Uint8Array([0x10, 0x61, 0x05, 0x00]), new Uint8Array(10)));
});
