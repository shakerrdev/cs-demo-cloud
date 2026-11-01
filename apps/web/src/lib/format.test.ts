import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeName } from './format.ts';

test('place names read like callouts', () => {
	assert.deepEqual(
		['TopofMid', 'BombsiteA', 'CTSpawn', 'BackofA', 'ARamp', 'Palace'].map(placeName),
		['Top of Mid', 'Bombsite A', 'CT Spawn', 'Back of A', 'A Ramp', 'Palace']
	);
});
