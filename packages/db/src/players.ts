import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { demos, kills, matchPlayers, matches, rounds, steamLinks } from './schema.ts';
import { getSetting, setSetting } from './settings.ts';

export function getPlayerMatches(db: Db, steamid: string) {
	return db
		.select({
			demoId: demos.id,
			playedAt: sql<number>`coalesce(${demos.fileModifiedAt}, ${demos.createdAt})`,
			map: matches.map,
			platform: matches.platform,
			tickRate: matches.tickRate,
			roundCount: matches.roundCount,
			scoreA: matches.scoreA,
			scoreB: matches.scoreB,
			name: matchPlayers.name,
			team: matchPlayers.team,
			kills: matchPlayers.kills,
			deaths: matchPlayers.deaths,
			assists: matchPlayers.assists,
			damage: matchPlayers.damage,
			headshotKills: matchPlayers.headshotKills,
			mvps: matchPlayers.mvps
		})
		.from(matchPlayers)
		.innerJoin(matches, eq(matches.demoId, matchPlayers.demoId))
		.innerJoin(demos, eq(demos.id, matchPlayers.demoId))
		.where(and(eq(matchPlayers.steamid, steamid), eq(demos.status, 'ready')))
		.orderBy(desc(sql`coalesce(${demos.fileModifiedAt}, ${demos.createdAt})`))
		.all()
		.map((row) => ({ ...row, playedAt: new Date(row.playedAt) }));
}

export function getMatchesForStats(db: Db, demoIds: string[]) {
	if (!demoIds.length) return [];
	const playerRows = db
		.select({ demoId: matchPlayers.demoId, steamid: matchPlayers.steamid, team: matchPlayers.team })
		.from(matchPlayers)
		.where(inArray(matchPlayers.demoId, demoIds))
		.all();
	const roundRows = db
		.select({
			demoId: rounds.demoId,
			number: rounds.number,
			winnerTeam: rounds.winnerTeam,
			teamASide: rounds.teamASide
		})
		.from(rounds)
		.where(inArray(rounds.demoId, demoIds))
		.orderBy(asc(rounds.number))
		.all();
	const killRows = db
		.select({
			demoId: kills.demoId,
			round: kills.round,
			tick: kills.tick,
			attackerSteamid: kills.attackerSteamid,
			victimSteamid: kills.victimSteamid,
			assisterSteamid: kills.assisterSteamid,
			flashAssist: kills.flashAssist
		})
		.from(kills)
		.where(inArray(kills.demoId, demoIds))
		.orderBy(asc(kills.round), asc(kills.tick))
		.all();
	return demoIds.map((demoId) => ({
		demoId,
		players: playerRows.filter((row) => row.demoId === demoId),
		rounds: roundRows.filter((row) => row.demoId === demoId),
		kills: killRows.filter((row) => row.demoId === demoId)
	}));
}

export function listPlayers(db: Db) {
	return db
		.select({
			steamid: matchPlayers.steamid,
			name: sql<string>`(select mp2.name from match_players mp2 join demos d2 on d2.id = mp2.demo_id where mp2.steamid = ${matchPlayers.steamid} order by coalesce(d2.file_modified_at, d2.created_at) desc limit 1)`,
			matches: sql<number>`count(*)`,
			kills: sql<number>`sum(${matchPlayers.kills})`,
			deaths: sql<number>`sum(${matchPlayers.deaths})`
		})
		.from(matchPlayers)
		.innerJoin(demos, eq(demos.id, matchPlayers.demoId))
		.where(eq(demos.status, 'ready'))
		.groupBy(matchPlayers.steamid)
		.orderBy(desc(sql`count(*)`), asc(sql`2`))
		.all();
}

const ownSteamIdKey = (userId: string) => `user.${userId}.steamId`;

export function getOwnSteamId(db: Db, userId: string): string | null {
	const chosen = getSetting(db, ownSteamIdKey(userId));
	if (chosen) return chosen;
	return (
		db
			.select({ steamId: steamLinks.steamId })
			.from(steamLinks)
			.where(eq(steamLinks.userId, userId))
			.get()?.steamId ?? null
	);
}

export function setOwnSteamId(db: Db, userId: string, steamId: string | null): void {
	setSetting(db, ownSteamIdKey(userId), steamId);
}

export function getOwnResults(db: Db, steamId: string) {
	return db
		.select({
			demoId: matchPlayers.demoId,
			team: matchPlayers.team,
			kills: matchPlayers.kills,
			deaths: matchPlayers.deaths
		})
		.from(matchPlayers)
		.where(eq(matchPlayers.steamid, steamId))
		.all();
}

export function getPlayerRounds(db: Db, steamid: string, map: string) {
	return db
		.select({
			demoId: rounds.demoId,
			parsedAt: matches.parsedAt,
			playedAt: sql<number>`coalesce(${demos.fileModifiedAt}, ${demos.createdAt})`,
			team: matchPlayers.team,
			number: rounds.number,
			teamASide: rounds.teamASide,
			winnerTeam: rounds.winnerTeam,
			teamAEquipment: rounds.teamAEquipment,
			teamBEquipment: rounds.teamBEquipment
		})
		.from(matchPlayers)
		.innerJoin(matches, eq(matches.demoId, matchPlayers.demoId))
		.innerJoin(demos, eq(demos.id, matchPlayers.demoId))
		.innerJoin(rounds, eq(rounds.demoId, matchPlayers.demoId))
		.where(and(eq(matchPlayers.steamid, steamid), eq(matches.map, map), eq(demos.status, 'ready')))
		.orderBy(desc(sql`coalesce(${demos.fileModifiedAt}, ${demos.createdAt})`), asc(rounds.number))
		.all()
		.map((row) => ({ ...row, playedAt: new Date(row.playedAt) }));
}
