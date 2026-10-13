import { error, redirect } from '@sveltejs/kit';
import { getDemo, getMatch, requeueDemo } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import { isDemoId } from '#lib/server/storage.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	if (!isDemoId(params.id)) error(404, 'Demo not found');
	const demo = getDemo(db, params.id);
	if (!demo) error(404, 'Demo not found');
	return { demo, details: getMatch(db, params.id) ?? null };
};

export const actions: Actions = {
	reparse: ({ params }) => {
		if (!isDemoId(params.id) || !getDemo(db, params.id)) error(404, 'Demo not found');
		requeueDemo(db, params.id);
		redirect(303, '/');
	}
};
