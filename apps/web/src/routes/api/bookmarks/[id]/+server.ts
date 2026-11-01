import { error } from '@sveltejs/kit';
import { deleteBookmark, updateBookmarkNote } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
	if (typeof body?.note !== 'string') error(400, 'Send a note');
	updateBookmarkNote(db, params.id, body.note);
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = ({ params }) => {
	deleteBookmark(db, params.id);
	return new Response(null, { status: 204 });
};
