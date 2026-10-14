import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
	connectGameCoordinator,
	type CsClient,
	type SteamClient,
	type SteamLibrary
} from './game-coordinator.ts';

const shareCode = 'CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK';
const matchId = '3230642215713767580';

interface FakeOptions {
	loginError?: string;
	blocked?: boolean;
	gcConnects?: boolean;
	matches?: unknown[][];
}

function fakeLibrary(options: FakeOptions = {}) {
	const calls: string[] = [];
	let steam!: SteamClient;
	let cs!: CsClient;

	const library: SteamLibrary = {
		createSteamClient() {
			steam = Object.assign(new EventEmitter(), {
				logOn(details: { refreshToken: string }) {
					calls.push(`logOn ${details.refreshToken}`);
					if (options.loginError) steam.emit('error', new Error(options.loginError));
					else {
						steam.emit('refreshToken', 'renewed-token');
						steam.emit('loggedOn', {});
					}
				},
				logOff() {
					calls.push('logOff');
				},
				gamesPlayed(apps: number[]) {
					calls.push(`gamesPlayed ${apps.join(',')}`);
					if (apps.length === 0) return;
					if (options.blocked) steam.emit('playingState', true, 730);
					else if (options.gcConnects !== false) setImmediate(() => cs.emit('connectedToGC'));
				},
				async requestFreeLicense(apps: number[]) {
					calls.push(`license ${apps.join(',')}`);
					return {};
				}
			});
			return steam;
		},
		createCsClient() {
			let request = 0;
			cs = Object.assign(new EventEmitter(), {
				requestGame(code: string) {
					calls.push(`requestGame ${code}`);
					const answers = options.matches?.[request++] ?? [];
					setImmediate(() => cs.emit('matchList', answers));
				}
			});
			return cs;
		}
	};
	return { library, calls };
}

test('logs in, launches CS2, finds the demo link and logs off', async () => {
	const refreshed: string[] = [];
	const { library, calls } = fakeLibrary({
		matches: [
			[
				{ matchid: '1', matchtime: 1, roundstatsall: [{ map: 'http://wrong' }] },
				{
					matchid: matchId,
					matchtime: 1760000000,
					roundstatsall: [{ map: null }, { map: 'http://replay129.valve.net/730/003_1.dem.bz2' }]
				}
			]
		]
	});

	const gc = await connectGameCoordinator({
		refreshToken: 'token',
		onRefreshToken: (token) => refreshed.push(token),
		library
	});
	const demo = await gc.lookup(shareCode);
	await gc.close();

	assert.deepEqual(demo, {
		url: 'http://replay129.valve.net/730/003_1.dem.bz2',
		matchTime: new Date(1760000000 * 1000)
	});
	assert.deepEqual(refreshed, ['renewed-token']);
	assert.deepEqual(calls, [
		'logOn token',
		'license 730',
		'gamesPlayed 730',
		`requestGame ${shareCode}`,
		'gamesPlayed ',
		'logOff'
	]);
});

test('returns null when Valve has no demo link for the match', async () => {
	const { library } = fakeLibrary({
		matches: [[{ matchid: matchId, matchtime: 1, roundstatsall: [] }]]
	});
	const gc = await connectGameCoordinator({ refreshToken: 'token', library });
	assert.equal(await gc.lookup(shareCode), null);
});

test('explains an expired bot login', async () => {
	const { library } = fakeLibrary({ loginError: 'Expired' });
	await assert.rejects(
		connectGameCoordinator({ refreshToken: 'token', library }),
		/Connect the bot account again/
	);
});

test('fails and logs off when the bot is playing elsewhere', async () => {
	const { library, calls } = fakeLibrary({ blocked: true });
	await assert.rejects(
		connectGameCoordinator({ refreshToken: 'token', library }),
		/another device/
	);
	assert.equal(calls.at(-1), 'logOff');
});

test('times out when the Game Coordinator never connects', async () => {
	const { library, calls } = fakeLibrary({ gcConnects: false });
	await assert.rejects(
		connectGameCoordinator({ refreshToken: 'token', library, timeoutMs: 50 }),
		/Game Coordinator/
	);
	assert.equal(calls.at(-1), 'logOff');
});

test('times out a lookup that gets no matching answer', async () => {
	const { library } = fakeLibrary({ matches: [[{ matchid: '999' }]] });
	const gc = await connectGameCoordinator({ refreshToken: 'token', library, lookupTimeoutMs: 50 });
	await assert.rejects(gc.lookup(shareCode), /didn't answer/);
	await assert.rejects(gc.lookup('CSGO-bad'), /Invalid match code/);
});
