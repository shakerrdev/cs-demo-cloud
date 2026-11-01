import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchStats, type StatsKill, type StatsPlayer } from './stats.ts';

const players: StatsPlayer[] = [
	...['a1', 'a2', 'a3', 'a4', 'a5'].map((steamid) => ({ steamid, team: 'a' as const })),
	...['b1', 'b2', 'b3', 'b4', 'b5'].map((steamid) => ({ steamid, team: 'b' as const }))
];

const kill = (
	tick: number,
	attacker: string | null,
	victim: string,
	extra: Partial<StatsKill> = {}
): StatsKill => ({
	round: 1,
	tick,
	attackerSteamid: attacker,
	victimSteamid: victim,
	assisterSteamid: null,
	flashAssist: false,
	...extra
});

const of = (stats: ReturnType<typeof matchStats>, id: string) =>
	stats.players.find((p) => p.steamid === id)!;

test('opening duel, trade and KAST', () => {
	const stats = matchStats(
		players,
		[{ number: 1, winnerTeam: 'a' }],
		[
			kill(100, 'b1', 'a1'),
			kill(200, 'a2', 'b1', { assisterSteamid: 'a3', flashAssist: true }),
			kill(5000, 'a2', 'b2'),
			kill(5100, 'a4', 'b3'),
			kill(5200, 'a4', 'b4'),
			kill(5300, 'a4', 'b5')
		],
		64
	);
	assert.equal(of(stats, 'b1').openingKills, 1);
	assert.equal(of(stats, 'a1').openingDeaths, 1);
	assert.deepEqual(stats.openings, [{ round: 1, team: 'b' }]);
	assert.equal(of(stats, 'a2').trades, 1);
	assert.equal(of(stats, 'a1').tradedDeaths, 1);
	assert.equal(of(stats, 'a1').kast, 1);
	assert.equal(of(stats, 'a3').flashAssists, 1);
	assert.equal(of(stats, 'a3').kast, 1);
	assert.deepEqual(of(stats, 'a2').multiKills, [1, 0, 0, 0]);
	assert.deepEqual(of(stats, 'a4').multiKills, [0, 1, 0, 0]);
	assert.equal(of(stats, 'b2').kast, 0);
});

test('a late kill is not a trade', () => {
	const stats = matchStats(
		players,
		[{ number: 1, winnerTeam: 'b' }],
		[kill(100, 'b1', 'a1'), kill(100 + 64 * 6, 'a2', 'b1')],
		64
	);
	assert.equal(of(stats, 'a2').trades, 0);
	assert.equal(of(stats, 'a1').kast, 0);
});

test('clutches: 1v4 won, and the last enemy lost a 1v1', () => {
	const stats = matchStats(
		players,
		[{ number: 1, winnerTeam: 'a' }],
		[
			kill(100, 'b1', 'a1'),
			kill(200, 'b1', 'a2'),
			kill(300, 'b2', 'a3'),
			kill(400, 'a5', 'b1'),
			kill(500, 'b3', 'a4'),
			kill(600, 'a5', 'b2'),
			kill(700, 'a5', 'b3'),
			kill(800, 'a5', 'b4'),
			kill(900, 'a5', 'b5')
		],
		64
	);
	assert.deepEqual(of(stats, 'a5').clutches, [{ round: 1, opponents: 4, won: true }]);
	assert.deepEqual(of(stats, 'b5').clutches, [{ round: 1, opponents: 1, won: false }]);
	assert.deepEqual(of(stats, 'a5').multiKills, [0, 0, 0, 1]);
});

test('team kills and suicides are not opening kills', () => {
	const stats = matchStats(
		players,
		[{ number: 1, winnerTeam: null }],
		[kill(50, 'a1', 'a2'), kill(60, null, 'b1'), kill(70, 'b2', 'a3')],
		64
	);
	assert.equal(of(stats, 'a1').openingKills, 0);
	assert.equal(of(stats, 'b2').openingKills, 1);
});
