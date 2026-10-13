import { redirect } from '@sveltejs/kit';
import { deleteSession } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import { SESSION_COOKIE, clearSessionCookie } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ cookies, url }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) deleteSession(db, token);
	clearSessionCookie(cookies, url);
	redirect(303, '/login');
};
