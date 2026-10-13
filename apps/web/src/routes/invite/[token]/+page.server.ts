import { fail, redirect } from '@sveltejs/kit';
import { AuthError, acceptInvite, createSession, getOpenInvite } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	const invite = getOpenInvite(db, params.token);
	return {
		valid: Boolean(invite),
		role: invite?.role ?? null,
		expiresAt: invite?.expiresAt ?? null,
		signedInAs: locals.user?.name ?? null
	};
};

export const actions: Actions = {
	default: async ({ request, params, cookies, url }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '');
		const password = String(form.get('password') ?? '');

		if (password !== String(form.get('confirm') ?? '')) {
			return fail(400, { name, message: 'The passwords don’t match' });
		}

		try {
			const user = await acceptInvite(db, params.token, name, password);
			const session = createSession(db, user.id);
			setSessionCookie(cookies, url, session.token, session.expiresAt);
		} catch (cause) {
			if (cause instanceof AuthError) return fail(400, { name, message: cause.message });
			throw cause;
		}
		redirect(303, '/');
	}
};
