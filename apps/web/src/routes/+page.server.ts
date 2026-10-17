import { error, redirect } from '@sveltejs/kit';
import { listDemos, requeueAllDemos } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	return { demos: listDemos(db), isAdmin: locals.user?.role === 'admin' };
};

export const actions: Actions = {
	reparseAll: ({ locals }) => {
		if (locals.user?.role !== 'admin') error(403, 'Only admins can parse every demo again');
		requeueAllDemos(db);
		redirect(303, '/');
	}
};
