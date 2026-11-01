import { error, json } from '@sveltejs/kit';
import { addBookmark, createPlaylist, getDemo, getPlaylist } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

interface Body {
	demoId?: unknown;
	round?: unknown;
	tick?: unknown;
	note?: unknown;
	playlistId?: unknown;
	playlistName?: unknown;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as Body | null;
	if (!body || typeof body.demoId !== 'string' || !getDemo(db, body.demoId))
		error(400, 'Unknown demo');
	const round = Number(body.round);
	const tick = Number(body.tick);
	if (!Number.isInteger(round) || round < 1 || !Number.isFinite(tick) || tick < 0)
		error(400, 'Round and tick are required');

	let playlistId = typeof body.playlistId === 'string' ? body.playlistId : '';
	if (playlistId && !getPlaylist(db, playlistId)) error(400, 'Unknown playlist');
	if (!playlistId) {
		const name = typeof body.playlistName === 'string' ? body.playlistName : '';
		if (!name.trim()) error(400, 'Pick a playlist or name a new one');
		playlistId = createPlaylist(db, name, locals.user?.id ?? null).id;
	}

	const bookmark = addBookmark(db, {
		playlistId,
		demoId: body.demoId,
		round,
		tick: Math.round(tick),
		note: typeof body.note === 'string' ? body.note : '',
		createdBy: locals.user?.id ?? null
	});
	return json({ id: bookmark.id, playlistId }, { status: 201 });
};
