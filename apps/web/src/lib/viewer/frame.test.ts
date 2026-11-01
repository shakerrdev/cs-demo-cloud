import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	REPLAY_VERSION,
	createColumns,
	packPitch,
	packYaw,
	type RoundReplay
} from '@cs-demo-cloud/replay';
import { defuseProgress, directorPick, playerStates, recentHurts, setposCommand } from './frame.ts';

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

test('the director picks whoever is about to get a kill', () => {
	const frames = 40;
	const columns = createColumns(3 * frames);
	columns.flags.fill(1);
	for (let f = 20; f < frames; f++) columns.flags[2 * frames + f] = 0;
	const kill = (tick: number, attacker: number, victim: number) => ({ tick, attacker, victim });
	const replay = {
		meta: {
			version: REPLAY_VERSION,
			round: 1,
			tickRate: 64,
			tickStep: 16,
			startTick: 0,
			frameCount: frames,
			freezeEndTick: 0,
			endTick: 640,
			players: [0, 1, 2].map((i) => ({
				steamid: String(i),
				name: String(i),
				team: 'a',
				side: 'CT'
			})),
			weapons: [''],
			kills: [kill(320, 1, 2), kill(600, 0, 1)],
			shots: [],
			grenades: [],
			effects: [],
			bomb: [],
			blinds: []
		},
		columns
	} as unknown as RoundReplay;
	assert.equal(directorPick(replay, 0, 0), 0);
	assert.equal(directorPick(replay, 100, 0), 1);
	assert.equal(directorPick(replay, 330, 2), 0);
	assert.equal(directorPick(replay, 330, 1), 1);
});

test('defuse progress counts from the defuse start, faster with a kit', () => {
	const columns = createColumns(2);
	columns.flags.set([1 | 4 | 8, 1 | 8]);
	const replay = {
		meta: {
			version: REPLAY_VERSION,
			round: 1,
			tickRate: 64,
			tickStep: 64,
			startTick: 0,
			frameCount: 2,
			freezeEndTick: 0,
			endTick: 64,
			players: [{ steamid: 's', name: 'p', team: 'a', side: 'CT' }],
			weapons: [''],
			kills: [],
			shots: [],
			grenades: [],
			effects: [],
			bomb: [{ type: 'defuse_start', tick: 0, player: 0, x: 0, y: 0, z: 0, site: 'A' }],
			blinds: []
		},
		columns
	} as unknown as RoundReplay;
	const withKit = playerStates(replay, 0)[0]!;
	assert.deepEqual(defuseProgress(replay, withKit, 128), { fraction: 0.4, left: 3 });
	const noKit = { ...withKit, defuser: false };
	assert.deepEqual(defuseProgress(replay, noKit, 128), { fraction: 0.2, left: 8 });
	assert.equal(defuseProgress(replay, { ...withKit, defusing: false }, 128), null);
});

test('recent hurts keep the last second of damage, newest last', () => {
	const replay = {
		meta: {
			tickRate: 64,
			hurts: [10, 1, 2, 27, 5, 0, 70, 1, 2, 100, 0, 1, 200, 3, 2, 0, 9, 0]
		}
	} as unknown as RoundReplay;
	assert.deepEqual(
		recentHurts(replay, 100, 1.5).map((h) => [h.victim, h.damage, h.head, Math.round(h.age * 64)]),
		[
			[1, 27, false, 90],
			[1, 100, true, 30]
		]
	);
	assert.deepEqual(
		recentHurts(replay, 120, 1).map((h) => h.damage),
		[100]
	);
	assert.deepEqual(recentHurts({ meta: { tickRate: 64 } } as unknown as RoundReplay, 100), []);
});
