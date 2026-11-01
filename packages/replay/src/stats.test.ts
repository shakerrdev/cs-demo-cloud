import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	addSideSplit,
	emptySideSplit,
	matchHighlights,
	matchStats,
	type StatsKill,
	type StatsPlayer
} from './stats.ts';

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
	assert.deepEqual(of(stats, 'a5').clutches, [{ round: 1, tick: 500, opponents: 4, won: true }]);
	assert.deepEqual(of(stats, 'b5').clutches, [{ round: 1, tick: 800, opponents: 1, won: false }]);
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

test('highlights: multi-kills and won clutches in round order', () => {
	const kills = [
		kill(100, 'b1', 'a1'),
		kill(200, 'b1', 'a2'),
		kill(300, 'b2', 'a3'),
		kill(400, 'a5', 'b1'),
		kill(500, 'b3', 'a4'),
		kill(600, 'a5', 'b2'),
		kill(700, 'a5', 'b3'),
		kill(800, 'a5', 'b4'),
		kill(900, 'a5', 'b5')
	];
	const stats = matchStats(players, [{ number: 1, winnerTeam: 'a' }], kills, 64);
	assert.deepEqual(matchHighlights(players, kills, stats), [
		{ kind: 'multi', steamid: 'a5', round: 1, tick: 400, kills: 5 },
		{ kind: 'clutch', steamid: 'a5', round: 1, tick: 500, opponents: 4 }
	]);
});

test('side split counts rounds, wins, kills, deaths, KAST and pistols per side', () => {
	const rounds = [
		{ number: 1, winnerTeam: 'a' as const, teamASide: 'CT' as const },
		{ number: 2, winnerTeam: 'b' as const, teamASide: 'CT' as const },
		{ number: 3, winnerTeam: 'a' as const, teamASide: 'T' as const }
	];
	const kills = [
		{ ...kill(100, 'a1', 'b1'), round: 1 },
		{ ...kill(200, 'b2', 'a1'), round: 2 },
		{ ...kill(300, 'a1', 'b3'), round: 3 },
		{ ...kill(310, 'a1', 'a2'), round: 3 }
	];
	const split = addSideSplit(
		emptySideSplit(),
		'a1',
		'a',
		players,
		rounds,
		kills,
		[1, 3],
		new Set([1, 3])
	);
	assert.deepEqual(split.CT, { rounds: 2, won: 1, kills: 1, deaths: 1, kastRounds: 1 });
	assert.deepEqual(split.T, { rounds: 1, won: 1, kills: 1, deaths: 0, kastRounds: 1 });
	assert.equal(split.pistols, 2);
	assert.equal(split.pistolsWon, 2);
});
