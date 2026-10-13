import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from './client.ts';
import {
	demos,
	kills,
	matchPlayers,
	matches,
	rounds,
	type NewKill,
	type NewMatch,
	type NewMatchPlayer,
	type NewRound
} from './schema.ts';

export interface ParsedMatch {
	match: NewMatch;
	players: NewMatchPlayer[];
	rounds: NewRound[];
	kills: NewKill[];
}

export function saveMatch(db: Db, parsed: ParsedMatch): void {
	const demoId = parsed.match.demoId;
	db.transaction((tx) => {
		tx.delete(kills).where(eq(kills.demoId, demoId)).run();
		tx.delete(rounds).where(eq(rounds.demoId, demoId)).run();
		tx.delete(matchPlayers).where(eq(matchPlayers.demoId, demoId)).run();
		tx.delete(matches).where(eq(matches.demoId, demoId)).run();

		tx.insert(matches).values(parsed.match).run();
		if (parsed.players.length) tx.insert(matchPlayers).values(parsed.players).run();
		if (parsed.rounds.length) tx.insert(rounds).values(parsed.rounds).run();
		for (let i = 0; i < parsed.kills.length; i += 500) {
			tx.insert(kills)
				.values(parsed.kills.slice(i, i + 500))
				.run();
		}
	});
}

export function getMatch(db: Db, demoId: string) {
	const row = db
		.select({ demo: demos, match: matches })
		.from(demos)
		.innerJoin(matches, eq(matches.demoId, demos.id))
		.where(eq(demos.id, demoId))
		.get();
	if (!row) return undefined;

	return {
		...row,
		players: db
			.select()
			.from(matchPlayers)
			.where(eq(matchPlayers.demoId, demoId))
			.orderBy(desc(matchPlayers.score), desc(matchPlayers.kills))
			.all(),
		rounds: db
			.select()
			.from(rounds)
			.where(eq(rounds.demoId, demoId))
			.orderBy(asc(rounds.number))
			.all()
	};
}
