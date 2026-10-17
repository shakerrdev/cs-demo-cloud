import { error, fail, redirect } from '@sveltejs/kit';
import { getDemo, getMatch, requeueDemo } from '@cs-demo-cloud/db';
import { PLAYER_PACK, SKINS_PACK, readMapPack } from '@cs-demo-cloud/shared';
import { loadConfig } from '#lib/server/config.ts';
import { db } from '#lib/server/db.ts';
import { canRemoveDemo, removeDemo } from '#lib/server/demos.ts';
import { isDemoId, storage } from '#lib/server/storage.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!isDemoId(params.id)) error(404, 'Demo not found');
	const demo = getDemo(db, params.id);
	if (!demo) error(404, 'Demo not found');
	const details = getMatch(db, params.id) ?? null;
	const pack = details ? await readMapPack(storage, details.match.map) : null;
	const players = pack ? await readMapPack(storage, PLAYER_PACK) : null;
	const skins = players ? await readMapPack(storage, SKINS_PACK) : null;
	return {
		demo,
		details,
		mapPack: pack?.version ?? null,
		playerPack: players?.version ?? null,
		skinsPack: skins?.version ?? null,
		canDelete: canRemoveDemo(locals.user, demo),
		config: loadConfig()
	};
};

export const actions: Actions = {
	reparse: ({ params }) => {
		if (!isDemoId(params.id) || !getDemo(db, params.id)) error(404, 'Demo not found');
		requeueDemo(db, params.id);
		redirect(303, '/');
	},
	delete: async ({ params, locals }) => {
		if (!isDemoId(params.id)) error(404, 'Demo not found');
		const result = await removeDemo(locals.user, params.id);
		if (result === 'forbidden') error(403, 'Only admins and the uploader can delete this demo');
		if (result === 'busy')
			return fail(409, { message: 'The demo is being parsed right now; try again in a moment' });
		redirect(303, '/');
	}
};
