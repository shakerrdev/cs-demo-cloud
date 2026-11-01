import { fail, redirect } from '@sveltejs/kit';
import { addBookmark, createPlaylist } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import { libraryHighlights } from '#lib/server/highlights.ts';
import type { Actions, PageServerLoad } from './$types';

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

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const form = await request.formData();
		const keys = new Set(form.getAll('item').map(String));
		const name = String(form.get('name') ?? '').trim() || 'Highlights';
		const items = libraryHighlights().filter(({ demoId, highlight }) =>
			keys.has(`${demoId}/${highlight.round}/${highlight.steamid}/${highlight.kind}`)
		);
		if (!items.length) return fail(400, { message: 'Nothing to save' });
		const playlist = createPlaylist(db, name, locals.user?.id ?? null);
		for (const { demoId, tickRate, name: player, highlight } of items) {
			addBookmark(db, {
				playlistId: playlist.id,
				demoId,
				round: highlight.round,
				tick: Math.max(0, highlight.tick - 3 * tickRate),
				note: `${player}: ${highlight.kind === 'multi' ? `${highlight.kills}K` : `1v${highlight.opponents} clutch`}`,
				createdBy: locals.user?.id ?? null
			});
		}
		redirect(303, `/playlists/${playlist.id}`);
	}
};
