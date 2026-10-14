import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bloomBlendMode, limitTextureSize } from './export.ts';

test('maps bloom blend modes from names and numbers', () => {
	assert.equal(bloomBlendMode('BLOOM_BLEND_SCREEN'), 'screen');
	assert.equal(bloomBlendMode('BLOOM_BLEND_ADD'), 'add');
	assert.equal(bloomBlendMode(2), 'blur');
	assert.equal(bloomBlendMode('something else'), undefined);
	assert.equal(bloomBlendMode(undefined), undefined);
});

test('drops mips above the size limit', () => {
	const mipData = [16, 8, 4, 2, 1].map((size) => new Uint8Array(size * size * 4));
	const texture = {
		width: 16,
		height: 16,
		depth: 1,
		faces: 1 as const,
		mips: 5,
		format: 'rgba8' as const,
		flags: 0,
		mipData
	};
	const limited = limitTextureSize(texture, 4);
	assert.equal(limited.width, 4);
	assert.equal(limited.height, 4);
	assert.equal(limited.mips, 3);
	assert.equal(limited.mipData[0], mipData[2]);
	assert.equal(limitTextureSize(texture, 64), texture);
});
