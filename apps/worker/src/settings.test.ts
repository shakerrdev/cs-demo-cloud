import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillCrosshairs, type PlayerSettings } from './settings.ts';

test('fillCrosshairs carries codes into rounds without one', () => {
	const rounds: Map<string, PlayerSettings>[] = [
		new Map([['a', {}]]),
		new Map([['a', { crosshair: 'X' }]]),
		new Map([['a', {}]]),
		new Map([
			['a', { crosshair: 'Y' }],
			['b', {}]
		])
	];
	fillCrosshairs(rounds);
	assert.deepEqual(
		rounds.map((round) => round.get('a')?.crosshair),
		['X', 'X', 'X', 'Y']
	);
	assert.equal(rounds[3]!.get('b')?.crosshair, undefined);
});
