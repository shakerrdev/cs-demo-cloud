import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import {
	AuthError,
	acceptInvite,
	changePassword,
	countUsers,
	createDemo,
	createInvite,
	createSession,
	deleteUser,
	getOpenInvite,
	getSession,
	listUsers,
	login,
	removeBootstrapInvites
} from './index.ts';
import { openDb, type Db } from './client.ts';
import { runMigrations } from './migrations.ts';
import { demos, sessions } from './schema.ts';

let dir: string;
let db: Db;

before(() => {
	dir = mkdtempSync(join(tmpdir(), 'cs-demo-cloud-auth-'));
	db = openDb(join(dir, 'test.db'));
	runMigrations(db);
});

after(() => {
	db.$client.close();
	rmSync(dir, { recursive: true, force: true });
});

test('an invite creates exactly one account with its role', async () => {
	const { token } = createInvite(db, { role: 'admin' });

	const user = await acceptInvite(db, token, '  Shaker ', 'correct horse battery');

	assert.equal(user.name, 'Shaker');
	assert.equal(user.role, 'admin');
	assert.equal(getOpenInvite(db, token), undefined);
	await assert.rejects(acceptInvite(db, token, 'someone', 'correct horse battery'), AuthError);
	assert.equal(countUsers(db), 1);
});

test('names are unique regardless of case', async () => {
	const { token } = createInvite(db, { role: 'member' });

	await assert.rejects(acceptInvite(db, token, 'SHAKER', 'another long password'), /already taken/);
	assert.ok(getOpenInvite(db, token), 'a failed sign-up keeps the invite usable');
});

test('rejects short passwords and odd names before using the invite', async () => {
	const { token } = createInvite(db, { role: 'member' });

	await assert.rejects(acceptInvite(db, token, 'friend', 'short'), /at least 10/);
	await assert.rejects(acceptInvite(db, token, 'x', 'long enough password'), /2 to 32/);
	await assert.rejects(
		acceptInvite(db, token, 'drop<table>', 'long enough password'),
		/letters, numbers/
	);
	assert.ok(getOpenInvite(db, token));
});

test('expired invites cannot be used', async () => {
	const { token } = createInvite(db, { role: 'member', ttlMs: -1000 });

	assert.equal(getOpenInvite(db, token), undefined);
	await assert.rejects(acceptInvite(db, token, 'late', 'long enough password'), /expired/);
});

test('login checks the password and ignores name case', async () => {
	assert.equal((await login(db, 'shaker', 'correct horse battery'))?.name, 'Shaker');
	assert.equal(await login(db, 'Shaker', 'wrong password!!'), null);
	assert.equal(await login(db, 'nobody', 'correct horse battery'), null);
});

test('sessions resolve to the user and extend when they get old', () => {
	const user = listUsers(db)[0]!;
	const { token } = createSession(db, user.id);

	assert.equal(getSession(db, token)?.user.name, 'Shaker');
	assert.equal(getSession(db, 'not-a-token'), null);

	const soon = new Date(Date.now() + 60_000);
	db.update(sessions).set({ expiresAt: soon }).run();
	const refreshed = getSession(db, token);
	assert.equal(refreshed?.refreshed, true);
	assert.ok(refreshed!.expiresAt.getTime() > soon.getTime());

	db.update(sessions)
		.set({ expiresAt: new Date(Date.now() - 1000) })
		.run();
	assert.equal(getSession(db, token), null);
});

test('changing the password signs out other sessions only', async () => {
	const user = listUsers(db)[0]!;
	const current = createSession(db, user.id);
	const other = createSession(db, user.id);

	await assert.rejects(
		changePassword(db, user.id, current.token, 'wrong', 'a brand new password'),
		/current password/
	);
	await changePassword(db, user.id, current.token, 'correct horse battery', 'a brand new password');

	assert.ok(getSession(db, current.token));
	assert.equal(getSession(db, other.token), null);
	assert.ok(await login(db, 'shaker', 'a brand new password'));
});

test('removing a user keeps their uploads', async () => {
	const { token } = createInvite(db, { role: 'member' });
	const friend = await acceptInvite(db, token, 'friend', 'long enough password');
	const demo = createDemo(db, {
		fileName: 'a.dem',
		format: 'dem',
		fileSize: 1,
		fileModifiedAt: null,
		sha256: 'abc',
		source: 'upload',
		uploadedBy: friend.id
	});
	assert.equal(listUsers(db).find((u) => u.id === friend.id)?.uploads, 1);

	deleteUser(db, friend.id);

	const kept = db.select().from(demos).where(eq(demos.id, demo.id)).get();
	assert.equal(kept?.uploadedBy, null);
});

test('bootstrap cleanup only removes unused invites nobody created', () => {
	const admin = listUsers(db)[0]!;
	const fromCli = createInvite(db, { role: 'admin' });
	const fromAdmin = createInvite(db, { role: 'member', createdBy: admin.id });

	removeBootstrapInvites(db);

	assert.equal(getOpenInvite(db, fromCli.token), undefined);
	assert.ok(getOpenInvite(db, fromAdmin.token));
});
