import { getMatchesForStats, getPlayerMatches } from '@cs-demo-cloud/db';
import { matchStats } from '@cs-demo-cloud/replay';
import { db } from './db.ts';

export interface PlayerMatch {
	demoId: string;
	playedAt: Date;
	map: string;
	platform: 'valve' | 'faceit' | 'other';
	result: 'win' | 'loss' | 'tie';
	own: number;
	other: number;
	kills: number;
	deaths: number;
	assists: number;
	adr: number;
	kast: number | null;
	headshotPercent: number;
}

export interface MapRecord {
	map: string;
	matches: number;
	wins: number;
	losses: number;
	adr: number;
	kd: number;
}

export function playerProfile(steamid: string) {
	const rows = getPlayerMatches(db, steamid);
	if (!rows.length) return null;

	const statsByDemo = new Map(
		getMatchesForStats(
			db,
			rows.map((r) => r.demoId)
		).map((m) => {
			const tickRate = rows.find((r) => r.demoId === m.demoId)!.tickRate;
			const stats = matchStats(m.players, m.rounds, m.kills, tickRate);
			return [m.demoId, stats.players.find((p) => p.steamid === steamid) ?? null];
		})
	);

	const matches: PlayerMatch[] = rows.map((row) => {
		const own = row.team === 'a' ? row.scoreA : row.scoreB;
		const other = row.team === 'a' ? row.scoreB : row.scoreA;
		const stats = statsByDemo.get(row.demoId);
		return {
			demoId: row.demoId,
			playedAt: row.playedAt,
			map: row.map,
			platform: row.platform,
			result: own > other ? 'win' : own < other ? 'loss' : 'tie',
			own,
			other,
			kills: row.kills,
			deaths: row.deaths,
			assists: row.assists,
			adr: row.damage / Math.max(1, row.roundCount),
			kast: stats ? stats.kast : null,
			headshotPercent: row.kills ? row.headshotKills / row.kills : 0
		};
	});

	const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + pick(r), 0);
	const roundsPlayed = sum((r) => r.roundCount);
	const kastRounds = [...statsByDemo.values()].reduce((t, s) => t + (s?.kastRounds ?? 0), 0);
	const kastTotal = [...statsByDemo.values()].reduce((t, s) => t + (s?.rounds ?? 0), 0);
	const allStats = [...statsByDemo.values()].filter((s) => s !== null);

	const byMap = new Map<
		string,
		MapRecord & { damage: number; rounds: number; k: number; d: number }
	>();
	matches.forEach((m, i) => {
		const row = rows[i]!;
		const record = byMap.get(m.map) ?? {
			map: m.map,
			matches: 0,
			wins: 0,
			losses: 0,
			adr: 0,
			kd: 0,
			damage: 0,
			rounds: 0,
			k: 0,
			d: 0
		};
		record.matches++;
		if (m.result === 'win') record.wins++;
		if (m.result === 'loss') record.losses++;
		record.damage += row.damage;
		record.rounds += row.roundCount;
		record.k += row.kills;
		record.d += row.deaths;
		byMap.set(m.map, record);
	});

	return {
		steamid,
		name: rows[0]!.name,
		names: [...new Set(rows.map((r) => r.name))],
		summary: {
			matches: rows.length,
			wins: matches.filter((m) => m.result === 'win').length,
			losses: matches.filter((m) => m.result === 'loss').length,
			ties: matches.filter((m) => m.result === 'tie').length,
			kills: sum((r) => r.kills),
			deaths: sum((r) => r.deaths),
			assists: sum((r) => r.assists),
			adr: sum((r) => r.damage) / Math.max(1, roundsPlayed),
			headshotPercent:
				sum((r) => r.headshotKills) /
				Math.max(
					1,
					sum((r) => r.kills)
				),
			kast: kastTotal ? kastRounds / kastTotal : null,
			openingKills: allStats.reduce((t, s) => t + s.openingKills, 0),
			openingDeaths: allStats.reduce((t, s) => t + s.openingDeaths, 0),
			clutchesWon: allStats.reduce((t, s) => t + s.clutches.filter((c) => c.won).length, 0),
			clutches: allStats.reduce((t, s) => t + s.clutches.length, 0),
			multiKills: allStats.reduce(
				(t, s) => t.map((v, i) => v + s.multiKills[i]!) as [number, number, number, number],
				[0, 0, 0, 0] as [number, number, number, number]
			)
		},
		maps: [...byMap.values()]
			.map(({ damage, rounds, k, d, ...record }) => ({
				...record,
				adr: damage / Math.max(1, rounds),
				kd: k / Math.max(1, d)
			}))
			.sort((a, b) => b.matches - a.matches || a.map.localeCompare(b.map)),
		matches
	};
}
