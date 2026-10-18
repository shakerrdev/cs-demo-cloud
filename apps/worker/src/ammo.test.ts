import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createColumns } from '@cs-demo-cloud/replay';
import { estimateReserve } from './ammo.ts';

test('reserve ammo is rebuilt from reloads for players the demo lacks it for', () => {
	const cols = createColumns(6);
	const clips = [20, 12, 3, 20, 20, 12];
	const weapons = [1, 1, 1, 1, 2, 2];
	clips.forEach((clip, i) => {
		cols.clip![i] = clip;
		cols.weapon[i] = weapons[i]!;
	});
	estimateReserve(cols, 1, 6, ['', 'M4A1-S', 'USP-S']);
	assert.deepEqual([...cols.reserve!], [80, 80, 80, 63, 24, 24]);
});

test('players with real reserve ammo keep it', () => {
	const cols = createColumns(2);
	cols.clip!.set([20, 20]);
	cols.weapon.set([1, 1]);
	cols.reserve!.set([60, 60]);
	estimateReserve(cols, 1, 2, ['', 'M4A1-S']);
	assert.deepEqual([...cols.reserve!], [60, 60]);
});
