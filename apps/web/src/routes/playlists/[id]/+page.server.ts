import { error, fail, redirect } from '@sveltejs/kit';
import {
	deleteBookmark,
	deletePlaylist,
	getPlaylist,
	renamePlaylist,
	updateBookmarkNote
} from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const playlist = getPlaylist(db, params.id);
	if (!playlist) error(404, 'Playlist not found');
	return { playlist };
};

export const actions: Actions = {
	rename: async ({ params, request }) => {
		const name = String((await request.formData()).get('name') ?? '');
		if (!name.trim()) return fail(400, { message: 'Give the playlist a name' });
		renamePlaylist(db, params.id, name);
	},
	note: async ({ request }) => {
		const form = await request.formData();
		updateBookmarkNote(db, String(form.get('id')), String(form.get('note') ?? ''));
	},
	remove: async ({ request }) => {
		deleteBookmark(db, String((await request.formData()).get('id')));
	},
	delete: ({ params }) => {
		deletePlaylist(db, params.id);
		redirect(303, '/playlists');
	}
};
