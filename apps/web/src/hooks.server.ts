import { json, redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/env';
import {
	countUsers,
	createInvite,
	deleteExpiredSessions,
	getSession,
	removeBootstrapInvites
} from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import { SESSION_COOKIE, clearSessionCookie, setSessionCookie } from '#lib/server/session.ts';

const publicPaths = [/^\/login\/?$/, /^\/invite\/[^/]+\/?$/, /^\/healthz\/?$/, /^\/robots\.txt$/];

export const init: ServerInit = () => {
	if (building) return;
	deleteExpiredSessions(db);
	if (countUsers(db) > 0) return;

	removeBootstrapInvites(db);
	const { token } = createInvite(db, { role: 'admin' });
	const fallback = dev ? 'http://localhost:5173' : `http://localhost:${process.env.PORT || 3000}`;
	const origin = (process.env.ORIGIN || fallback).replace(/\/$/, '');
	const hint =
		process.env.ORIGIN || dev
			? ''
			: `On another device, replace ${fallback} with this machine's address.\n`;
	console.log(
		`\nNo accounts yet. Create the admin account with this link (valid for 7 days):\n${origin}/invite/${token}\n${hint}`
	);
};

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	const session = token ? getSession(db, token) : null;
	event.locals.user = session?.user ?? null;

	if (token && !session) clearSessionCookie(event.cookies, event.url);
	if (token && session?.refreshed)
		setSessionCookie(event.cookies, event.url, token, session.expiresAt);

	const path = event.url.pathname;
	if (!event.locals.user && !publicPaths.some((pattern) => pattern.test(path))) {
		if (path.startsWith('/api/') || path.startsWith('/maps/')) {
			return json({ message: 'Sign in first' }, { status: 401 });
		}
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}

	return resolve(event);
};
