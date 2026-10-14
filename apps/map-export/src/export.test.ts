import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bloomBlendMode, envMapNormalization, limitTextureSize } from './export.ts';

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

test('turns a cube map array layer’s radiance into a luminance normalization', () => {
	const sh = new Array(54).fill(0);
	const second = 27;
	for (const [channel, weight] of [
		[0, 0.2125],
		[1, 0.7154],
		[2, 0.0721]
	] as const) {
		sh[second + channel * 9] = 1 / weight / 3;
		sh[second + channel * 9 + 1] = 2 / weight / 3;
		sh[second + channel * 9 + 2] = 3 / weight / 3;
		sh[second + channel * 9 + 3] = 4 / weight / 3;
	}
	const [x, y, z, w] = envMapNormalization(sh, 1);
	assert.ok(Math.abs(x - 4 * 0.325735) < 1e-6);
	assert.ok(Math.abs(y - 2 * 0.325735) < 1e-6);
	assert.ok(Math.abs(z - 3 * 0.325735) < 1e-6);
	assert.ok(Math.abs(w - 0.282095) < 1e-6);
	assert.deepEqual(envMapNormalization(sh, 2), [0, 0, 0, 0]);
	assert.deepEqual(envMapNormalization(undefined, 0), [0, 0, 0, 0]);
});
