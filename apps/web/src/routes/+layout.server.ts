import { getOwnSteamId } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	return {
		user: locals.user,
		ownSteamId: locals.user ? getOwnSteamId(db, locals.user.id) : null
	};
};
