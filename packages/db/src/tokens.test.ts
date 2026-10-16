import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import {
	AuthError,
	acceptInvite,
	createApiToken,
	createDemo,
	createInvite,
	deleteDemo,
	deleteUser,
	getApiTokenUser,
	getDemo,
	listApiTokens,
	revokeApiToken
} from './index.ts';
import { openDb, type Db } from './client.ts';
import { runMigrations } from './migrations.ts';
import { matches, valveMatches } from './schema.ts';

let dir: string;
let db: Db;

before(() => {
	dir = mkdtempSync(join(tmpdir(), 'cs-demo-cloud-tokens-'));
	db = openDb(join(dir, 'test.db'));
	runMigrations(db);
});

after(() => {
	db.$client.close();
	rmSync(dir, { recursive: true, force: true });
});

async function user(name: string) {
	const { token } = createInvite(db, { role: 'member' });
	return acceptInvite(db, token, name, 'correct horse battery');
}

test('api tokens sign in as their owner until revoked', async () => {
	const owner = await user('owner');
	const other = await user('other');
	const { token, row } = createApiToken(db, owner.id, ' FACEIT extension ');

	assert.match(token, /^cdc_/);
	assert.notEqual(row.id, token);
	assert.equal(row.name, 'FACEIT extension');
	assert.equal(row.hint, token.slice(-4));
	assert.deepEqual(getApiTokenUser(db, token), owner);
	assert.ok(listApiTokens(db, owner.id)[0]!.lastUsedAt);
	assert.equal(getApiTokenUser(db, `${token}x`), null);
	assert.equal(getApiTokenUser(db, 'not a token'), null);

	assert.equal(revokeApiToken(db, other.id, row.id), false, 'others cannot revoke it');
	assert.equal(revokeApiToken(db, owner.id, row.id), true);
	assert.equal(getApiTokenUser(db, token), null);
	assert.deepEqual(listApiTokens(db, owner.id), []);
});

test('token names are checked and tokens go with their user', async () => {
	const owner = await user('leaver');
	assert.throws(() => createApiToken(db, owner.id, '   '), AuthError);
	const { token } = createApiToken(db, owner.id, 'script');
	deleteUser(db, owner.id);
	assert.equal(getApiTokenUser(db, token), null);
});

test('deleting a demo removes its match and unlinks valve matches', () => {
	const demo = createDemo(db, {
		fileName: 'b.dem',
		format: 'dem',
		fileSize: 1,
		fileModifiedAt: null,
		sha256: 'delete-me',
		source: 'upload'
	});
	db.insert(matches)
		.values({
			demoId: demo.id,
			map: 'de_mirage',
			serverName: '',
			platform: 'valve',
			tickRate: 64,
			durationSeconds: 1,
			roundCount: 0,
			scoreA: 0,
			scoreB: 0,
			teamAName: 'A',
			teamBName: 'B',
			teamAStartSide: 'CT',
			replayVersion: 1,
			parseMs: 1
		})
		.run();
	db.insert(valveMatches)
		.values({ matchId: '42', shareCode: 'CSGO-x', status: 'done', demoId: demo.id })
		.run();

	assert.equal(deleteDemo(db, demo.id)?.id, demo.id);
	assert.equal(getDemo(db, demo.id), undefined);
	assert.equal(db.select().from(matches).where(eq(matches.demoId, demo.id)).get(), undefined);
	assert.equal(db.select().from(valveMatches).get()?.demoId, null);
	assert.equal(deleteDemo(db, demo.id), undefined);
});
