import { getMatchesForStats, listDemos } from '@cs-demo-cloud/db';
import { matchHighlights, matchStats, type Highlight } from '@cs-demo-cloud/replay';
import { db } from './db.ts';

export interface LibraryHighlight {
	demoId: string;
	map: string;
	playedAt: Date;
	tickRate: number;
	name: string;
	highlight: Highlight;
}

const cache = new Map<string, { version: number; items: LibraryHighlight[] }>();

export function libraryHighlights(): LibraryHighlight[] {
	const ready = listDemos(db).filter(({ demo, match }) => demo.status === 'ready' && match);
	const stale = ready.filter(
		({ demo, match }) => cache.get(demo.id)?.version !== match!.parsedAt.getTime()
	);
	const live = new Set(ready.map(({ demo }) => demo.id));
	for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);

	for (let i = 0; i < stale.length; i += 50) {
		const batch = stale.slice(i, i + 50);
		for (const stats of getMatchesForStats(
			db,
			batch.map(({ demo }) => demo.id)
		)) {
			const { demo, match } = batch.find(({ demo }) => demo.id === stats.demoId)!;
			const computed = matchStats(stats.players, stats.rounds, stats.kills, match!.tickRate);
			const highlights = matchHighlights(stats.players, stats.kills, computed);
			const names = new Map(stats.players.map((p) => [p.steamid, p.name]));
			cache.set(demo.id, {
				version: match!.parsedAt.getTime(),
				items: highlights.map((highlight) => ({
					demoId: demo.id,
					map: match!.map,
					playedAt: demo.fileModifiedAt ?? demo.createdAt,
					tickRate: match!.tickRate,
					name: names.get(highlight.steamid) ?? '',
					highlight
				}))
			});
		}
	}
	return [...cache.values()]
		.flatMap((entry) => entry.items)
		.sort(
			(a, b) => b.playedAt.getTime() - a.playedAt.getTime() || a.highlight.round - b.highlight.round
		);
}
