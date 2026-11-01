import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureTiming } from './timing.ts';
import type { ReplayBombEvent } from './types.ts';

const bomb = (type: ReplayBombEvent['type'], tick: number): ReplayBombEvent => ({
	type,
	tick,
	player: 0,
	x: 0,
	y: 0,
	z: 0,
	site: 'A'
});

test('measures round and bomb time from the match itself', () => {
	const timing = measureTiming(
		[
			{ freezeEndTick: 1000, endTick: 1000 + 64 * 105, reason: 'target_saved', bomb: [] },
			{ freezeEndTick: 0, endTick: 64 * 105, reason: 'target_saved', bomb: [] },
			{ freezeEndTick: 0, endTick: 900, reason: 't_killed', bomb: [] },
			{
				freezeEndTick: 0,
				endTick: 9000,
				reason: 'target_bombed',
				bomb: [bomb('plant', 2000), bomb('explode', 2000 + 64 * 45)]
			}
		],
		64
	);
	assert.deepEqual(timing, { roundSeconds: 105, bombSeconds: 45 });
});

test('leaves timings unknown when no round shows them', () => {
	assert.deepEqual(
		measureTiming([{ freezeEndTick: 0, endTick: 900, reason: 'ct_killed', bomb: [] }], 64),
		{
			roundSeconds: null,
			bombSeconds: null
		}
	);
});

test('ignores saved rounds where the bomb was planted', () => {
	const timing = measureTiming(
		[
			{ freezeEndTick: 0, endTick: 64 * 80, reason: 'target_saved', bomb: [bomb('plant', 64 * 30)] }
		],
		64
	);
	assert.equal(timing.roundSeconds, null);
});
