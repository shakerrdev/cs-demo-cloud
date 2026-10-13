import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RawEvent } from './parser.ts';
import { detectRounds } from './rounds.ts';

const event = (
	event_name: string,
	tick: number,
	extra: Record<string, unknown> = {}
): RawEvent => ({
	event_name,
	tick,
	is_warmup_period: false,
	...extra
});

test('splits a plain match into rounds with freeze ends', () => {
	const rounds = detectRounds(
		[
			event('begin_new_match', 60),
			event('round_start', 65, { round: 1 }),
			event('round_freeze_end', 1441),
			event('round_end', 5101, { round: 1, winner: 'CT', reason: 'bomb_defused' }),
			event('round_start', 5549, { round: 2 }),
			event('round_freeze_end', 6509),
			event('round_end', 9088, { round: 2, winner: 'T', reason: 'ct_killed' })
		],
		9600,
		64
	);

	assert.deepEqual(
		rounds.map((r) => [
			r.number,
			r.startTick,
			r.freezeEndTick,
			r.endTick,
			r.lastTick,
			r.winner,
			r.reason
		]),
		[
			[1, 65, 1441, 5101, 5549, 'CT', 'bomb_defused'],
			[2, 5549, 6509, 9088, 9408, 'T', 'ct_killed']
		]
	);
});

test('drops a knife round and warmup played before the match starts', () => {
	const rounds = detectRounds(
		[
			event('begin_new_match', 0),
			event('round_start', 0, { round: 1 }),
			event('round_end', 2600, { round: 1, winner: 'T', reason: 'ct_killed' }),
			event('round_start', 2774, { round: 1, is_warmup_period: true }),
			event('round_start', 4901, { round: 1 }),
			event('begin_new_match', 4905),
			event('round_freeze_end', 6597),
			event('round_end', 10181, { round: 2, winner: 'T', reason: 'ct_killed' })
		],
		11000,
		64
	);

	assert.equal(rounds.length, 1);
	assert.deepEqual(
		[rounds[0]!.number, rounds[0]!.startTick, rounds[0]!.freezeEndTick],
		[1, 4901, 6597]
	);
});

test('keeps the replayed version of a restarted round', () => {
	const rounds = detectRounds(
		[
			event('round_start', 100, { round: 1 }),
			event('round_end', 900, { round: 1, winner: 'CT', reason: 't_killed' }),
			event('round_start', 1000, { round: 1 }),
			event('round_end', 2000, { round: 1, winner: 'T', reason: 'bomb_exploded' })
		],
		2400,
		64
	);

	assert.deepEqual(
		rounds.map((r) => [r.startTick, r.winner]),
		[[1000, 'T']]
	);
});

test('ignores warmup rounds and rounds without a winner', () => {
	const rounds = detectRounds(
		[
			event('round_end', 50, { round: 0, winner: null }),
			event('round_end', 80, { round: 1, winner: 'CT', is_warmup_period: true }),
			event('round_start', 100, { round: 1 }),
			event('round_end', 900, { round: 1, winner: 'CT', reason: 't_killed' })
		],
		1200,
		64
	);

	assert.deepEqual(
		rounds.map((r) => r.endTick),
		[900]
	);
});
