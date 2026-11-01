import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './client.ts';
import { createDemo } from './demos.ts';
import { saveMatch } from './matches.ts';
import { runMigrations } from './migrations.ts';
import {
	getMatchesForStats,
	getOwnResults,
	getOwnSteamId,
	getPlayerMatches,
	listPlayers,
	setOwnSteamId
} from './players.ts';
import { demos } from './schema.ts';

let dir: string;
let db: Db;

before(() => {
	dir = mkdtempSync(join(tmpdir(), 'cs-demo-cloud-players-'));
	db = openDb(join(dir, 'test.db'));
	runMigrations(db);
});

after(() => rmSync(dir, { recursive: true, force: true }));

function addMatch(sha256: string, modified: number, status: 'ready' | 'failed' = 'ready') {
	const demo = createDemo(db, {
		fileName: `${sha256}.dem`,
		fileSize: 1,
		sha256,
		source: 'upload',
		fileModifiedAt: new Date(modified)
	});
	db.update(demos).set({ status }).where(eq(demos.id, demo.id)).run();
	saveMatch(db, {
		match: {
			demoId: demo.id,
			map: 'de_mirage',
			serverName: 'Valve',
			platform: 'valve',
			tickRate: 64,
			durationSeconds: 1,
			roundCount: 2,
			scoreA: 2,
			scoreB: 0,
			teamAStartSide: 'CT',
			replayVersion: 3,
			parseMs: 1
		},
		players: ['me', 'you'].map((steamid, i) => ({
			demoId: demo.id,
			steamid,
			name: steamid,
			team: i ? 'b' : 'a',
			kills: 2 - i,
			deaths: i,
			assists: 0,
			damage: 200,
			headshotKills: 1,
			mvps: 0,
			score: 0
		})),
		rounds: [1, 2].map((number) => ({
			demoId: demo.id,
			number,
			startTick: number * 100,
			freezeEndTick: null,
			endTick: number * 100 + 50,
			teamASide: 'CT',
			winnerSide: 'CT',
			winnerTeam: 'a',
			reason: 't_killed',
			scoreA: number,
			scoreB: 0
		})),
		kills: [
			{
				demoId: demo.id,
				round: 1,
				tick: 110,
				attackerSteamid: 'me',
				victimSteamid: 'you',
				assisterSteamid: null,
				weapon: 'ak47',
				headshot: true,
				wallbang: false,
				throughSmoke: false,
				noScope: false,
				attackerBlind: false,
				flashAssist: false
			}
		]
	});
	return demo.id;
}

test("a player's matches, newest first, without failed demos", () => {
	const older = addMatch('p1', 1000);
	const newer = addMatch('p2', 5000);
	addMatch('p3', 9000, 'failed');

	const rows = getPlayerMatches(db, 'me');
	assert.deepEqual(
		rows.map((r) => r.demoId),
		[newer, older]
	);
	assert.equal(rows[0]!.team, 'a');
	assert.equal(rows[0]!.playedAt.getTime(), 5000);

	const [stats] = getMatchesForStats(db, [newer]);
	assert.equal(stats!.players.length, 2);
	assert.equal(stats!.rounds.length, 2);
	assert.equal(stats!.kills.length, 1);

	const listed = listPlayers(db);
	assert.deepEqual(
		listed.map((p) => [p.steamid, p.matches]),
		[
			['me', 2],
			['you', 2]
		]
	);
});

test('own SteamID is chosen per user and gives their results', () => {
	assert.equal(getOwnSteamId(db, 'nobody'), null);
	setOwnSteamId(db, 'u1', 'me');
	assert.equal(getOwnSteamId(db, 'u1'), 'me');
	assert.ok(getOwnResults(db, 'me').every((row) => row.team === 'a' && row.kills === 2));
	setOwnSteamId(db, 'u1', null);
	assert.equal(getOwnSteamId(db, 'u1'), null);
});
