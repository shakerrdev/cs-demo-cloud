import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { getSteamBot, openDb, runMigrations, type Db } from '@cs-demo-cloud/db';
import { createBotLogins, refreshTokenExpiry, type BotSession } from './bot-login.ts';

let dir: string;
let db: Db;

before(() => {
	dir = mkdtempSync(join(tmpdir(), 'cs-demo-cloud-bot-'));
	db = openDb(join(dir, 'app.db'));
	runMigrations(db);
});

after(() => {
	db.$client.close();
	rmSync(dir, { recursive: true, force: true });
});

const jwt = (exp: number) =>
	['e30', Buffer.from(JSON.stringify({ exp })).toString('base64url'), 'sig'].join('.');

function fakeSession(script: {
	start?: () => Promise<{
		actionRequired: boolean;
		validActions?: { type: number; detail?: string }[];
	}>;
	codes?: Record<string, 'ok' | 'wrong'>;
}) {
	const session = Object.assign(new EventEmitter(), {
		loginTimeout: 30_000,
		accountName: 'cs_demo_bot',
		refreshToken: jwt(1790000000),
		steamID: { getSteamID64: () => '76561190000000001' },
		cancelled: false,
		async startWithCredentials() {
			return script.start ? script.start() : { actionRequired: false };
		},
		async submitSteamGuardCode(code: string) {
			if (script.codes?.[code] !== 'ok') throw new Error('InvalidLoginAuthCode');
			setImmediate(() => session.emit('authenticated'));
		},
		cancelLoginAttempt() {
			session.cancelled = true;
			return true;
		}
	});
	return session as BotSession & { cancelled: boolean };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('email code flow saves the bot after the right code', async () => {
	const session = fakeSession({
		start: async () => ({ actionRequired: true, validActions: [{ type: 2, detail: 'gmail.com' }] }),
		codes: { ABCDE: 'ok' }
	});
	const logins = createBotLogins(db, () => session);

	assert.deepEqual(await logins.start('admin', 'cs_demo_bot', 'pw'), {
		step: 'code',
		guard: 'email',
		detail: 'gmail.com',
		wrongCode: false
	});
	assert.equal(session.loginTimeout, 180_000);

	const wrong = await logins.submitCode('admin', 'XXXXX');
	assert.equal(wrong.step === 'code' && wrong.wrongCode, true);

	await logins.submitCode('admin', ' ABCDE ');
	await tick();
	assert.deepEqual(logins.state('admin'), { step: 'done', accountName: 'cs_demo_bot' });
	assert.deepEqual(getSteamBot(db), {
		accountName: 'cs_demo_bot',
		steamId: '76561190000000001',
		refreshToken: jwt(1790000000)
	});
});

test('app approval waits for the authenticated event', async () => {
	const session = fakeSession({
		start: async () => ({ actionRequired: true, validActions: [{ type: 4 }] })
	});
	const logins = createBotLogins(db, () => session);

	assert.deepEqual(await logins.start('admin', 'cs_demo_bot', 'pw'), { step: 'confirm' });
	session.emit('authenticated');
	assert.equal(logins.state('admin')?.step, 'done');
});

test('explains a wrong password and a timeout', async () => {
	const logins = createBotLogins(db, () =>
		fakeSession({
			start: async () => {
				throw new Error('InvalidPassword');
			}
		})
	);
	assert.deepEqual(await logins.start('admin', 'bot', 'bad'), {
		step: 'error',
		message: 'Wrong account name or password'
	});

	const session = fakeSession({
		start: async () => ({ actionRequired: true, validActions: [{ type: 4 }] })
	});
	const timed = createBotLogins(db, () => session);
	await timed.start('admin', 'bot', 'pw');
	session.emit('timeout');
	assert.equal(timed.state('admin')?.step, 'error');
});

test('starting again cancels the previous attempt', async () => {
	const first = fakeSession({
		start: async () => ({ actionRequired: true, validActions: [{ type: 4 }] })
	});
	const second = fakeSession({
		start: async () => ({ actionRequired: true, validActions: [{ type: 3 }] })
	});
	const sessions = [first, second];
	const logins = createBotLogins(db, () => sessions.shift()!);

	await logins.start('admin', 'bot', 'pw');
	const state = await logins.start('admin', 'bot', 'pw');

	assert.equal(first.cancelled, true);
	assert.equal(state.step === 'code' && state.guard, 'app');
	assert.equal((await createBotLogins(db).submitCode('nobody', '1')).step, 'error');
});

test('reads the expiry from a refresh token', () => {
	assert.deepEqual(refreshTokenExpiry(jwt(1790000000)), new Date(1790000000 * 1000));
	assert.equal(refreshTokenExpiry('garbage'), null);
});
