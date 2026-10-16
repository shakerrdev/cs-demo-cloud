import { error, redirect } from '@sveltejs/kit';
import { getDemo, getMatch, requeueDemo } from '@cs-demo-cloud/db';
import { PLAYER_PACK, readMapPack } from '@cs-demo-cloud/shared';
import { db } from '#lib/server/db.ts';
import { isDemoId, storage } from '#lib/server/storage.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (!isDemoId(params.id)) error(404, 'Demo not found');
	const demo = getDemo(db, params.id);
	if (!demo) error(404, 'Demo not found');
	const details = getMatch(db, params.id) ?? null;
	const pack = details ? await readMapPack(storage, details.match.map) : null;
	const players = pack ? await readMapPack(storage, PLAYER_PACK) : null;
	return { demo, details, mapPack: pack?.version ?? null, playerPack: players?.version ?? null };
};

export const actions: Actions = {
	reparse: ({ params }) => {
		if (!isDemoId(params.id) || !getDemo(db, params.id)) error(404, 'Demo not found');
		requeueDemo(db, params.id);
		redirect(303, '/');
	}
};
