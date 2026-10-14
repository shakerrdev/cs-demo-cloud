import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import {
	getDemo,
	getSteamBot,
	getSteamLink,
	getValveStatus,
	listRecentValveMatches,
	openDb,
	runMigrations,
	saveSteamLink,
	setSteamApiKey,
	setSteamBot,
	users,
	type Db
} from '@cs-demo-cloud/db';
import { createStorage, encodeShareCodeForTest, type Storage } from './test-helpers.ts';
import { runValveCycle } from './cycle.ts';
import type { ConnectOptions, GameCoordinator, MatchDemo } from './game-coordinator.ts';

const dirs: string[] = [];
let db: Db;
let storage: Storage;
let userId: string;

const codeA = encodeShareCodeForTest(3230642215713767580n);
const codeB = encodeShareCodeForTest(3230642215713767999n);
const urlA = 'http://replay129.valve.net/730/003_a.dem.bz2';
const fakeDemo = Buffer.concat([Buffer.from('BZh91AY&SY'), randomBytes(2048)]);

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), 'cs-demo-cloud-cycle-'));
	dirs.push(dir);
	db = openDb(join(dir, 'app.db'));
	runMigrations(db);
	storage = createStorage(dir);
	userId = db
		.insert(users)
		.values({ name: 'shaker', passwordHash: 'x', role: 'admin' })
		.returning()
		.get().id;
	setSteamApiKey(db, 'KEY');
	setSteamBot(db, { accountName: 'bot', steamId: '76561190000000001', refreshToken: 'old-token' });
	saveSteamLink(db, userId, {
		steamId: '76561198056395137',
		authCode: 'ABCD-EFGHJ-KLMN',
		knownCode: codeA.code,
		knownMatchId: codeA.matchId
	});
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function fakeFetch(
	routes: { history?: Record<string, number | string>; files?: Record<string, number> } = {}
) {
	return (async (input: URL | string | Request) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.hostname === 'api.steampowered.com') {
			const answer = routes.history?.[url.searchParams.get('knowncode') ?? ''] ?? 202;
			return typeof answer === 'number'
				? new Response(null, { status: answer })
				: Response.json({ result: { nextcode: answer } });
		}
		const status = routes.files?.[url.href] ?? 200;
		return status === 200 ? new Response(fakeDemo) : new Response(null, { status });
	}) as typeof fetch;
}

function fakeConnect(demos: Record<string, MatchDemo | null>, calls: string[] = []) {
	return async (options: ConnectOptions): Promise<GameCoordinator> => {
		calls.push(`connect ${options.refreshToken}`);
		options.onRefreshToken?.('new-token');
		return {
			async lookup(shareCode) {
				calls.push(`lookup ${shareCode}`);
				return demos[shareCode] ?? null;
			},
			async close() {
				calls.push('close');
			}
		};
	};
}

const matchStatus = (matchId: string) =>
	listRecentValveMatches(db).find((m) => m.matchId === matchId);

test('finds new matches, looks up demos, downloads and queues them', async () => {
	const calls: string[] = [];
	const matchTime = new Date('2026-10-12T20:00:00Z');

	const result = await runValveCycle({
		db,
		storage,
		delayMs: 0,
		fetch: fakeFetch({ history: { [codeA.code]: codeB.code } }),
		connect: fakeConnect({ [codeA.code]: { url: urlA, matchTime }, [codeB.code]: null }, calls)
	});

	assert.deepEqual(result, { found: 1, imported: 1 });
	assert.equal(getSteamLink(db, userId)?.knownCode, codeB.code);
	assert.equal(matchStatus(codeB.matchId)?.status, 'unavailable');

	const done = matchStatus(codeA.matchId);
	assert.equal(done?.status, 'done');
	const demo = getDemo(db, done!.demoId!);
	assert.equal(demo?.source, 'valve');
	assert.equal(demo?.fileName, '003_a.dem.bz2');
	assert.equal(demo?.format, 'bz2');
	assert.equal(demo?.status, 'queued');
	assert.equal(demo?.uploadedBy, userId);
	assert.deepEqual(demo?.fileModifiedAt, matchTime);
	assert.ok(existsSync(storage.demoPath(demo!.id, 'bz2')));

	assert.equal(calls.filter((c) => c.startsWith('connect')).length, 1);
	assert.equal(calls.at(-1), 'close');
	assert.equal(getSteamBot(db)?.refreshToken, 'new-token');
	assert.ok(getValveStatus(db).lastRunAt);
});

test('keeps matches pending and reports when no bot is connected', async () => {
	setSteamBot(db, null);

	await runValveCycle({ db, storage, delayMs: 0, fetch: fakeFetch(), connect: fakeConnect({}) });

	assert.equal(matchStatus(codeA.matchId)?.status, 'pending');
	assert.equal(matchStatus(codeA.matchId)?.attempts, 0);
	assert.match(getValveStatus(db).botError ?? '', /No Steam bot account/);
});

test('disables the link when Steam rejects the known code', async () => {
	await runValveCycle({
		db,
		storage,
		delayMs: 0,
		fetch: fakeFetch({ history: { [codeA.code]: 412 } }),
		connect: fakeConnect({ [codeA.code]: { url: urlA, matchTime: null } })
	});

	const link = getSteamLink(db, userId);
	assert.equal(link?.enabled, false);
	assert.match(link?.lastError ?? '', /latest match code/);
	assert.equal(matchStatus(codeA.matchId)?.status, 'done');
});

test('marks expired demos unavailable and retries failed downloads later', async () => {
	saveSteamLink(db, userId, {
		steamId: '76561198056395137',
		authCode: 'ABCD-EFGHJ-KLMN',
		knownCode: codeB.code,
		knownMatchId: codeB.matchId
	});
	const urlB = 'http://replay129.valve.net/730/003_b.dem.bz2';

	await runValveCycle({
		db,
		storage,
		delayMs: 0,
		fetch: fakeFetch({ files: { [urlA]: 404, [urlB]: 500 } }),
		connect: fakeConnect({
			[codeA.code]: { url: urlA, matchTime: null },
			[codeB.code]: { url: urlB, matchTime: null }
		})
	});

	assert.equal(matchStatus(codeA.matchId)?.status, 'unavailable');
	const retry = matchStatus(codeB.matchId);
	assert.equal(retry?.status, 'pending');
	assert.equal(retry?.attempts, 1);
	assert.match(retry?.error ?? '', /500/);

	const calls: string[] = [];
	await runValveCycle({
		db,
		storage,
		delayMs: 0,
		fetch: fakeFetch(),
		connect: fakeConnect({}, calls)
	});
	assert.equal(matchStatus(codeB.matchId)?.status, 'done');
	assert.deepEqual(calls, [], 'a known link is downloaded without logging the bot in again');
});

test('reports a failed bot login without counting it against the matches', async () => {
	await runValveCycle({
		db,
		storage,
		delayMs: 0,
		fetch: fakeFetch(),
		connect: async () => {
			throw new Error('Steam refused the bot login.');
		}
	});

	assert.equal(getValveStatus(db).botError, 'Steam refused the bot login.');
	assert.equal(matchStatus(codeA.matchId)?.attempts, 0);
});
