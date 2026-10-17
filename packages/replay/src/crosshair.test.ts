import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crosshairColor, decodeCrosshair } from './crosshair.ts';

test('decodes crosshair share codes from a demo', () => {
	const magixx = decodeCrosshair('CSGO-9vKLy-OAOok-Yrj2D-6t3oQ-7T8SA');
	assert.ok(magixx);
	assert.equal(magixx.style, 4);
	assert.equal(magixx.size, 2);
	assert.equal(magixx.gap, -3);
	assert.equal(magixx.thickness, 1);
	assert.equal(magixx.color, 4);
	assert.equal(magixx.outlineEnabled, true);
	assert.equal(crosshairColor(magixx), 'rgba(50, 250, 250, 1.000)');

	const sh1ro = decodeCrosshair('CSGO-Ldro4-hDUZL-YBjBr-HRVSe-sqUWJ');
	assert.equal(sh1ro?.size, 1);
	assert.equal(sh1ro?.gap, -4);
	assert.equal(sh1ro?.color, 1);
});

test('rejects broken codes', () => {
	assert.equal(decodeCrosshair('CSGO-9vKLy-OAOok-Yrj2D-6t3oQ-7T8SB'), null);
	assert.equal(decodeCrosshair('nonsense'), null);
});
