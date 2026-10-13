import type { Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = 'session';

export function setSessionCookie(cookies: Cookies, url: URL, token: string, expiresAt: Date) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies, url: URL) {
	cookies.delete(SESSION_COOKIE, { path: '/', secure: url.protocol === 'https:' });
}

export function safeRedirectTarget(value: string | null): string {
	return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}
