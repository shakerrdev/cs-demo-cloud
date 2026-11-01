import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buyType, pistolRounds, roundBuys, type EconomyRound } from './economy.ts';

test('buy types by equipment per player', () => {
	assert.equal(buyType(2000), 'eco');
	assert.equal(buyType(10000), 'semi');
	assert.equal(buyType(17000), 'force');
	assert.equal(buyType(26000), 'full');
	assert.equal(buyType(9000, 2), 'full');
});

const rounds = (count: number, half = 12): EconomyRound[] =>
	Array.from({ length: count }, (_, i) => ({
		number: i + 1,
		teamASide:
			i < half ? 'CT' : i < half * 2 ? 'T' : Math.floor((i - half * 2) / 3) % 2 ? 'T' : 'CT',
		teamAEquipment: 20000,
		teamBEquipment: 3000
	}));

test('pistol rounds are the first round of each regulation half only', () => {
	assert.deepEqual([...pistolRounds(rounds(30))], [1, 13]);
	assert.deepEqual([...pistolRounds(rounds(16, 8))], [1, 9]);
});

test('rounds without economy data have no buy type', () => {
	const list = rounds(14);
	list[2]!.teamAEquipment = null;
	const buys = roundBuys(list);
	assert.deepEqual(buys.get(1), { a: 'pistol', b: 'pistol' });
	assert.equal(buys.get(3), null);
	assert.deepEqual(buys.get(4), { a: 'force', b: 'eco' });
});
