import { error, redirect } from '@sveltejs/kit';
import { setAppConfigJson, type SessionUser } from '@cs-demo-cloud/db';
import { configFromForm } from '@cs-demo-cloud/replay';
import { loadConfig } from '#lib/server/config.ts';
import { db } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

function requireAdmin(user: SessionUser | null) {
	if (user?.role !== 'admin') error(403, 'Only admins can change these settings');
}

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals.user);
	return { config: loadConfig() };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		requireAdmin(locals.user);
		setAppConfigJson(db, configFromForm(await request.formData()));
		return { saved: true };
	},
	reset: ({ locals }) => {
		requireAdmin(locals.user);
		setAppConfigJson(db, null);
		redirect(303, '/admin');
	}
};
