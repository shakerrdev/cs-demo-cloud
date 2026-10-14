import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { openDb, type Db } from './client.ts';
import { runMigrations } from './migrations.ts';
import { users } from './schema.ts';
import {
	MAX_VALVE_ATTEMPTS,
	deleteSteamLink,
	getSteamApiKey,
	getSteamBot,
	getSteamLink,
	listEnabledSteamLinks,
	listPendingValveMatches,
	listRecentValveMatches,
	queueValveMatch,
	requestValveCheck,
	retryValveMatch,
	saveSteamLink,
	setSteamApiKey,
	setSteamBot,
	takeValveCheckRequest,
	updateValveMatch
} from './valve.ts';

let dir: string;
let db: Db;
let userId: string;

before(() => {
	dir = mkdtempSync(join(tmpdir(), 'cs-demo-cloud-valve-'));
	db = openDb(join(dir, 'test.db'));
	runMigrations(db);
	userId = db
		.insert(users)
		.values({ name: 'shaker', passwordHash: 'x', role: 'admin' })
		.returning()
		.get().id;
});

after(() => {
	db.$client.close();
	rmSync(dir, { recursive: true, force: true });
});

test('stores and clears steam settings', () => {
	assert.equal(getSteamApiKey(db), null);
	setSteamApiKey(db, 'KEY');
	setSteamApiKey(db, 'NEWKEY');
	assert.equal(getSteamApiKey(db), 'NEWKEY');

	setSteamBot(db, { accountName: 'bot', steamId: '76561190000000000', refreshToken: 'jwt' });
	assert.equal(getSteamBot(db)?.accountName, 'bot');
	setSteamBot(db, null);
	assert.equal(getSteamBot(db), null);
});

test('a check request is taken once', () => {
	assert.equal(takeValveCheckRequest(db), false);
	requestValveCheck(db);
	assert.equal(takeValveCheckRequest(db), true);
	assert.equal(takeValveCheckRequest(db), false);
});

test('saving a link queues its known match and re-enables it', () => {
	saveSteamLink(db, userId, {
		steamId: '76561198056395137',
		authCode: 'ABCD-EFGHJ-KLMN',
		knownCode: 'CSGO-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA',
		knownMatchId: '1'
	});
	saveSteamLink(db, userId, {
		steamId: '76561198056395137',
		authCode: 'ABCD-EFGHJ-KLMN',
		knownCode: 'CSGO-BBBBB-BBBBB-BBBBB-BBBBB-BBBBB',
		knownMatchId: '2'
	});

	assert.equal(getSteamLink(db, userId)?.knownCode, 'CSGO-BBBBB-BBBBB-BBBBB-BBBBB-BBBBB');
	assert.equal(listEnabledSteamLinks(db).length, 1);
	assert.deepEqual(
		listPendingValveMatches(db, 10)
			.map((m) => m.matchId)
			.sort(),
		['1', '2']
	);
});

test('the same match is queued once even if teammates both find it', () => {
	assert.equal(queueValveMatch(db, { matchId: '3', shareCode: 'CSGO-3', foundBy: userId }), true);
	assert.equal(queueValveMatch(db, { matchId: '3', shareCode: 'CSGO-3', foundBy: userId }), false);
});

test('repeated failures end in failed, and retry puts it back', () => {
	for (let i = 0; i < MAX_VALVE_ATTEMPTS; i++)
		updateValveMatch(db, '3', { failedAttempt: true, error: 'nope' });

	const match = listRecentValveMatches(db).find((m) => m.matchId === '3');
	assert.equal(match?.status, 'failed');
	assert.equal(match?.attempts, MAX_VALVE_ATTEMPTS);
	assert.ok(!listPendingValveMatches(db, 10).some((m) => m.matchId === '3'));

	retryValveMatch(db, '3');
	assert.ok(listPendingValveMatches(db, 10).some((m) => m.matchId === '3'));
});

test('pending matches with fewer attempts come first', () => {
	updateValveMatch(db, '1', { failedAttempt: true });
	assert.equal(listPendingValveMatches(db, 10).at(-1)?.matchId, '1');
});

test('removing the link keeps found matches', () => {
	deleteSteamLink(db, userId);
	assert.equal(getSteamLink(db, userId), undefined);
	assert.equal(listRecentValveMatches(db).length, 3);
});
