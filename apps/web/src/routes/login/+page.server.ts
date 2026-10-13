import { fail, redirect } from '@sveltejs/kit';
import { createSession, login } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import { createRateLimit } from '#lib/server/rate-limit.ts';
import { safeRedirectTarget, setSessionCookie } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

const perAccount = createRateLimit(10);
const perAddress = createRateLimit(50);

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, safeRedirectTarget(url.searchParams.get('next')));
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const address = getClientAddress();
		const accountKey = `${address}:${name.toLowerCase()}`;

		if (perAccount.blocked(accountKey) || perAddress.blocked(address)) {
			return fail(429, { name, message: 'Too many attempts. Try again in 15 minutes.' });
		}

		const user = name && password ? await login(db, name, password) : null;
		if (!user) {
			perAccount.hit(accountKey);
			perAddress.hit(address);
			return fail(400, { name, message: 'Wrong name or password' });
		}

		perAccount.reset(accountKey);
		const session = createSession(db, user.id);
		setSessionCookie(cookies, url, session.token, session.expiresAt);
		redirect(303, safeRedirectTarget(url.searchParams.get('next')));
	}
};
