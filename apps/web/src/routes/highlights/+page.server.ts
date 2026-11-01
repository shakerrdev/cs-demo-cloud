import { libraryHighlights } from '#lib/server/highlights.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const items = libraryHighlights().map(({ highlight, ...item }) => ({
		...item,
		kind: highlight.kind,
		steamid: highlight.steamid,
		round: highlight.round,
		tick: highlight.tick,
		size: highlight.kind === 'multi' ? highlight.kills : highlight.opponents
	}));
	return { items };
};
