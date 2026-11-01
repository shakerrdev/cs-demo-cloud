import { error, fail } from '@sveltejs/kit';
import { getDuels, getOwnSteamId, setOwnSteamId } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import { playerProfile } from '#lib/server/players.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const profile = playerProfile(params.steamid);
	if (!profile) error(404, 'No matches with this player');
	return { profile, duels: getDuels(db, params.steamid) };
};

export const actions: Actions = {
	me: ({ params, locals }) => {
		if (!locals.user) return fail(401);
		setOwnSteamId(db, locals.user.id, params.steamid);
	},
	notMe: ({ params, locals }) => {
		if (!locals.user) return fail(401);
		if (getOwnSteamId(db, locals.user.id) === params.steamid)
			setOwnSteamId(db, locals.user.id, null);
	}
};
