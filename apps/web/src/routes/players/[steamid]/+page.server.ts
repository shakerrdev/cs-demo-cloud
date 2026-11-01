import { error } from '@sveltejs/kit';
import { playerProfile } from '#lib/server/players.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const profile = playerProfile(params.steamid);
	if (!profile) error(404, 'No matches with this player');
	return { profile };
};
