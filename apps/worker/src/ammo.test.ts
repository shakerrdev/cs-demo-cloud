import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createColumns } from '@cs-demo-cloud/replay';
import { estimateReserve, reserveIsMissing } from './ammo.ts';

test('reserve ammo is rebuilt from reloads when the demo lacks it', () => {
	const cols = createColumns(6);
	const clips = [20, 12, 3, 20, 20, 12];
	const weapons = [1, 1, 1, 1, 2, 2];
	clips.forEach((clip, i) => {
		cols.clip![i] = clip;
		cols.weapon[i] = weapons[i]!;
	});
	assert.equal(reserveIsMissing([cols]), true);
	estimateReserve(cols, 1, 6, ['', 'M4A1-S', 'USP-S']);
	assert.deepEqual([...cols.reserve!], [80, 80, 80, 63, 24, 24]);
});
