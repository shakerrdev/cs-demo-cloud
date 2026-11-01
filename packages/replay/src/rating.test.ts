import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rating } from './rating.ts';

test('an average line rates about 1.0', () => {
	const value = rating({
		rounds: 24,
		kills: 17,
		deaths: 16,
		assists: 4,
		damage: 24 * 75,
		kast: 0.72
	});
	assert.ok(value > 0.9 && value < 1.15, `got ${value}`);
});

test('a dominant game rates well above a poor one', () => {
	const strong = rating({
		rounds: 20,
		kills: 30,
		deaths: 10,
		assists: 5,
		damage: 20 * 120,
		kast: 0.85
	});
	const weak = rating({
		rounds: 20,
		kills: 6,
		deaths: 18,
		assists: 2,
		damage: 20 * 40,
		kast: 0.45
	});
	assert.ok(strong > 1.5, `strong ${strong}`);
	assert.ok(weak < 0.6, `weak ${weak}`);
	assert.equal(rating({ rounds: 0, kills: 0, deaths: 0, assists: 0, damage: 0, kast: 0 }), 0);
});
