import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crosshairColor, decodeCrosshair } from './crosshair.ts';

test('decodes legacy CSGO share codes', () => {
	const magixx = decodeCrosshair('CSGO-9vKLy-OAOok-Yrj2D-6t3oQ-7T8SA');
	assert.ok(magixx);
	assert.equal(magixx.style, 4);
	assert.equal(magixx.length, 2);
	assert.equal(magixx.gap, 0.75);
	assert.equal(magixx.thickness, 1);
	assert.equal(magixx.screenHeight, 480);
	assert.equal(crosshairColor(magixx), 'rgba(50, 250, 250, 1.000)');

	const sh1ro = decodeCrosshair('CSGO-Ldro4-hDUZL-YBjBr-HRVSe-sqUWJ');
	assert.equal(sh1ro?.length, 1);
	assert.deepEqual(sh1ro?.color, [50, 250, 50, 255]);
});

test('decodes pixel CS share codes', () => {
	const shaker = decodeCrosshair('CS3zhyA6DxwUhhZbjCfN3pkfxObGycvb7yxxd4VQeD3SvR');
	assert.ok(shaker);
	assert.equal(shaker.screenHeight, 1440);
	assert.equal(shaker.style, 7);
	assert.equal(shaker.length, 2);
	assert.equal(shaker.thickness, 2);
	assert.equal(shaker.gap, 1);
	assert.equal(shaker.outline, null);
	assert.deepEqual(shaker.color, [0, 255, 29, 255]);

	const defaults = decodeCrosshair('CSpb9t3x5NtrX5fWaENsr8vusEtwpiURjzqauLkOiYHMqF');
	assert.ok(defaults);
	assert.equal(defaults.screenHeight, 1080);
	assert.equal(defaults.style, 7);
	assert.deepEqual(defaults.outline, { width: 1, color: [0, 0, 0, 255], half: false });
});

test('rejects broken codes', () => {
	assert.equal(decodeCrosshair('CSGO-9vKLy-OAOok-Yrj2D-6t3oQ-7T8SB'), null);
	assert.equal(decodeCrosshair('CS3zhyA6DxwUhhZbjCfN3pkfxObGycvb7yxxd4VQeD3SvS'), null);
	assert.equal(decodeCrosshair('nonsense'), null);
});
