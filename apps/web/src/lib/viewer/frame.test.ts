import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	REPLAY_VERSION,
	createColumns,
	packPitch,
	packYaw,
	type RoundReplay
} from '@cs-demo-cloud/replay';
import { setposCommand } from './frame.ts';

test('setpos command for a player at a tick', () => {
	const columns = createColumns(2);
	columns.x.set([100, 200]);
	columns.y.set([-50, -150]);
	columns.z.set([10, 10]);
	columns.yaw.set([packYaw(90), packYaw(90)]);
	columns.pitch.set([packPitch(-10), packPitch(-10)]);
	columns.flags.set([1, 1]);
	const replay = {
		meta: {
			version: REPLAY_VERSION,
			round: 1,
			tickRate: 64,
			tickStep: 4,
			startTick: 0,
			frameCount: 2,
			freezeEndTick: 0,
			endTick: 4,
			players: [{ steamid: 's', name: 'p', team: 'a', side: 'CT' }],
			weapons: [''],
			kills: [],
			shots: [],
			grenades: [],
			effects: [],
			bomb: [],
			blinds: []
		},
		columns
	} as unknown as RoundReplay;
	assert.equal(setposCommand(replay, 0, 2), 'setpos 150 -100 10;setang -10 90 0');
	assert.equal(setposCommand(replay, 3, 2), null);
});
