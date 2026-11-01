import { fail, redirect } from '@sveltejs/kit';
import { createPlaylist, listPlaylists } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ playlists: listPlaylists(db) });

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const name = String((await request.formData()).get('name') ?? '');
		if (!name.trim()) return fail(400, { message: 'Give the playlist a name' });
		const playlist = createPlaylist(db, name, locals.user?.id ?? null);
		redirect(303, `/playlists/${playlist.id}`);
	}
};
