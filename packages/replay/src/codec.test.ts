import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packYaw, unpackYaw, lerpAngle } from './angles.ts';
import { createColumns, createViewColumns, decodeRound, encodeRound } from './codec.ts';
import { REPLAY_VERSION, type RoundMeta } from './types.ts';

function meta(players: number, frameCount: number): RoundMeta {
	return {
		version: REPLAY_VERSION,
		round: 3,
		tickRate: 64,
		tickStep: 4,
		startTick: 1000,
		frameCount,
		freezeEndTick: 1960,
		endTick: 9000,
		winner: 'CT',
		reason: 'bomb_defused',
		scoreA: 2,
		scoreB: 1,
		players: Array.from({ length: players }, (_, i) => ({
			steamid: `7656119800000000${i}`,
			name: `player ${i}`,
			team: i % 2 ? 'b' : 'a',
			side: i % 2 ? 'T' : 'CT'
		})),
		weapons: ['', 'AK-47', 'USP-S'],
		kills: [],
		shots: [1200, 0, 1204, 1],
		grenades: [{ type: 'smoke', thrower: 1, path: [1100, 10, 20, 30, 1104, 40, 50, 60] }],
		effects: [],
		bomb: [],
		blinds: []
	};
}

test('round trip keeps every column and the metadata', () => {
	const m = meta(3, 50);
	const columns = createColumns(150);
	for (let i = 0; i < 150; i++) {
		columns.x[i] = -16000 + i * 211;
		columns.y[i] = 15000 - i * 199;
		columns.z[i] = i % 7 === 0 ? 11776 : -495;
		columns.yaw[i] = packYaw(((i * 37) % 360) - 180);
		columns.pitch[i] = (i % 180) * 100 - 9000;
		columns.money[i] = i * 400;
		columns.health[i] = 100 - (i % 100);
		columns.armor[i] = i % 101;
		columns.weapon[i] = i % 3;
		columns.flags[i] = i % 256;
	}

	const decoded = decodeRound(encodeRound({ meta: m, columns }));

	assert.deepEqual(decoded.meta, m);
	for (const key of Object.keys(columns) as (keyof typeof columns)[]) {
		assert.deepEqual(Array.from(decoded.columns[key]!), Array.from(columns[key]!), key);
	}
});

test('decodes from an unaligned view', () => {
	const m = meta(1, 3);
	const columns = createColumns(3);
	columns.x.set([5, -7, 9]);
	const encoded = encodeRound({ meta: m, columns });
	const shifted = new Uint8Array(encoded.length + 1);
	shifted.set(encoded, 1);

	const decoded = decodeRound(shifted.subarray(1));

	assert.deepEqual(Array.from(decoded.columns.x), [5, -7, 9]);
});

test('decodes from a pooled Node buffer', () => {
	const m = meta(2, 4);
	const columns = createColumns(8);
	columns.x.set([1, 2, 3, 4, 5, 6, 7, 8]);
	columns.health.set([100, 90, 80, 70, 60, 50, 40, 30]);
	const pooled = Buffer.from(encodeRound({ meta: m, columns }));

	const decoded = decodeRound(pooled);

	assert.deepEqual(Array.from(decoded.columns.x), [1, 2, 3, 4, 5, 6, 7, 8]);
	assert.deepEqual(Array.from(decoded.columns.health), [100, 90, 80, 70, 60, 50, 40, 30]);
	assert.deepEqual(Array.from(decoded.columns.y), [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('round trip keeps the extra columns and the view stream', () => {
	const m = { ...meta(2, 5), view: { tickStep: 2, startTick: 1000, frameCount: 9 } };
	const columns = createColumns(10);
	columns.clip!.set([30, 29, 28, 27, 26, 7, 7, 7, 6, 5]);
	columns.reserve!.set([90, 90, 90, 90, 90, 21, 21, 21, 21, 21]);
	columns.zoom!.set([0, 0, 1, 2, 0, 0, 0, 0, 0, 0]);
	columns.place!.set([1, 1, 1, 2, 2, 0, 3, 3, 3, 3]);
	const view = createViewColumns(18);
	for (let i = 0; i < 18; i++) {
		view.x[i] = -60000 + i * 7919;
		view.y[i] = 70000 - i * 3;
		view.z[i] = i * 16;
		view.yaw[i] = packYaw(i * 21);
		view.pitch[i] = -8900 + i * 1000;
		view.punchPitch[i] = -i * 50;
		view.punchYaw[i] = i * 3;
		view.duck[i] = (i * 40) % 256;
	}

	const decoded = decodeRound(encodeRound({ meta: m, columns, view }));

	assert.deepEqual(decoded.meta, m);
	for (const key of ['clip', 'reserve', 'zoom', 'place'] as const)
		assert.deepEqual(Array.from(decoded.columns[key]!), Array.from(columns[key]!), key);
	for (const key of Object.keys(view) as (keyof typeof view)[])
		assert.deepEqual(Array.from(decoded.view![key]), Array.from(view[key]), key);
});

test('still reads version 1 replays without the extra columns', () => {
	const m = { ...meta(1, 3), version: 1 };
	const columns = createColumns(3, false);
	columns.x.set([5, -7, 9]);
	columns.flags.set([64, 65, 66]);

	const decoded = decodeRound(encodeRound({ meta: m, columns }));

	assert.deepEqual(Array.from(decoded.columns.flags), [64, 65, 66]);
	assert.equal(decoded.columns.clip, undefined);
	assert.equal(decoded.view, undefined);
});

test('rejects data that is not a replay', () => {
	assert.throws(() => decodeRound(new Uint8Array(16)), /Not a replay file/);
});

test('yaw packing survives the wrap around', () => {
	assert.ok(Math.abs(unpackYaw(packYaw(-179.99)) - 180.01) < 0.01);
	assert.equal(unpackYaw(packYaw(90)), 90);
});

test('angles interpolate along the short way', () => {
	assert.equal(lerpAngle(350, 10, 0.5), 360);
	assert.equal(lerpAngle(10, 350, 0.5), 0);
	assert.equal(lerpAngle(90, 180, 0.5), 135);
});
