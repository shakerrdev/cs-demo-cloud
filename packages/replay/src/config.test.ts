import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	configFromForm,
	defaultConfig,
	horizontalToVerticalFov,
	normalizeConfig,
	soundGroupOf
} from './config.ts';

test('fills in defaults and drops values that are out of range or unknown', () => {
	const config = normalizeConfig({
		audio: { master: 7, groups: { music: { enabled: false, volume: 'loud' } } },
		viewer: { view: 'vr', roundSeconds: 100 },
		pov: { crosshairColor: 'red' },
		extra: true
	});

	assert.equal(config.audio.master, 1);
	assert.equal(config.audio.groups.music.enabled, false);
	assert.equal(config.audio.groups.music.volume, defaultConfig.audio.groups.music.volume);
	assert.equal(config.viewer.view, '2d');
	assert.equal(config.viewer.roundSeconds, 100);
	assert.equal(config.pov.crosshairColor, defaultConfig.pov.crosshairColor);
	assert.equal('extra' in config, false);
});

test('reads a submitted form, with unchecked toggles as off', () => {
	const form = new FormData();
	form.set('audio.master', '0.5');
	form.set('viewer.speed', '2');
	form.set('pov.crosshairColor', '#FF0000');
	form.set('audio.groups.guns.enabled', 'on');

	const config = configFromForm(form);

	assert.equal(config.audio.master, 0.5);
	assert.equal(config.viewer.speed, 2);
	assert.equal(config.pov.crosshairColor, '#ff0000');
	assert.equal(config.audio.groups.guns.enabled, true);
	assert.equal(config.audio.groups.footsteps.enabled, false);
	assert.equal(config.parsing.viewStream, false);
});

test('sorts sound keys into groups and converts the game fov', () => {
	assert.equal(soundGroupOf('shot:ak47'), 'guns');
	assert.equal(soundGroupOf('step:CT'), 'footsteps');
	assert.equal(soundGroupOf('bounce:he'), 'grenades');
	assert.equal(soundGroupOf('radio:ctwin'), 'announcer');
	assert.ok(Math.abs(horizontalToVerticalFov(90) - 73.74) < 0.01);
});
