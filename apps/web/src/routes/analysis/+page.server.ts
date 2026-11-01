import { getOwnSteamId, getPlayerMatches, getPlayerRounds, listPlayers } from '@cs-demo-cloud/db';
import { roundBuys, type BuyType, type Side, type TeamKey } from '@cs-demo-cloud/replay';
import { db } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

const MAX_ROUNDS = 60;

export const load: PageServerLoad = ({ url, locals }) => {
	const players = listPlayers(db);
	const own = locals.user ? getOwnSteamId(db, locals.user.id) : null;
	const player =
		url.searchParams.get('player') ?? (own && players.some((p) => p.steamid === own) ? own : null);
	if (!player) return { players, player: null, maps: [], filters: null, rounds: [], total: 0 };

	const matches = getPlayerMatches(db, player);
	const counts = new Map<string, number>();
	for (const match of matches) counts.set(match.map, (counts.get(match.map) ?? 0) + 1);
	const maps = [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
	const map = url.searchParams.get('map') ?? maps[0]?.name ?? '';
	const side = (url.searchParams.get('side') === 'CT' ? 'CT' : 'T') as Side;
	const buy = (url.searchParams.get('buy') ?? 'any') as 'any' | BuyType;
	const result = (url.searchParams.get('result') ?? 'any') as 'any' | 'won' | 'lost';

	const rows = map ? getPlayerRounds(db, player, map) : [];
	const byDemo = new Map<string, typeof rows>();
	for (const row of rows) byDemo.set(row.demoId, [...(byDemo.get(row.demoId) ?? []), row]);

	const matching = [...byDemo.values()].flatMap((demoRows) => {
		const buys = roundBuys(demoRows);
		return demoRows.filter((row) => {
			const team: TeamKey = row.team;
			const own = team === 'a' ? row.teamASide : row.teamASide === 'CT' ? 'T' : 'CT';
			if (own !== side) return false;
			if (buy !== 'any' && buys.get(row.number)?.[team] !== buy) return false;
			if (result === 'won' && row.winnerTeam !== team) return false;
			if (result === 'lost' && row.winnerTeam === team) return false;
			return true;
		});
	});

	return {
		players,
		player,
		maps,
		filters: { map, side, buy, result },
		total: matching.length,
		rounds: matching.slice(0, MAX_ROUNDS).map((row) => ({
			demoId: row.demoId,
			version: row.parsedAt.getTime(),
			playedAt: row.playedAt,
			round: row.number,
			team: row.team,
			won: row.winnerTeam === row.team
		}))
	};
};
