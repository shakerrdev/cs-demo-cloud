import { error, fail } from '@sveltejs/kit';
import {
	deleteSteamLink,
	getSteamApiKey,
	getSteamBot,
	getSteamLink,
	getValveStatus,
	listRecentValveMatches,
	requestValveCheck,
	retryValveMatch,
	saveSteamLink,
	setSteamApiKey,
	setSteamBot,
	type SessionUser
} from '@cs-demo-cloud/db';
import { isAuthCode, parseShareCode, parseSteamId, vanityName } from '@cs-demo-cloud/shared';
import { refreshTokenExpiry } from '#lib/server/bot-login.ts';
import { db } from '#lib/server/db.ts';
import { botLogins, maskSecret, resolveVanity } from '#lib/server/steam.ts';
import type { Actions, PageServerLoad } from './$types';

function requireAdmin(user: SessionUser | null): SessionUser {
	if (user?.role !== 'admin') error(403, 'Only admins can do that');
	return user;
}

export const load: PageServerLoad = ({ locals }) => {
	const user = locals.user!;
	const link = getSteamLink(db, user.id);
	const apiKey = getSteamApiKey(db);
	const bot = getSteamBot(db);
	const admin = user.role === 'admin';

	return {
		link: link && {
			steamId: link.steamId,
			authCode: maskSecret(link.authCode),
			knownCode: link.knownCode,
			enabled: link.enabled,
			lastCheckedAt: link.lastCheckedAt,
			lastError: link.lastError
		},
		ready: { apiKey: Boolean(apiKey), bot: Boolean(bot) },
		status: getValveStatus(db),
		recent: listRecentValveMatches(db, 25),
		admin: admin
			? {
					apiKey: apiKey ? maskSecret(apiKey) : null,
					bot: bot && {
						accountName: bot.accountName,
						steamId: bot.steamId,
						validUntil: refreshTokenExpiry(bot.refreshToken)
					},
					login: botLogins.state(user.id)
				}
			: null
	};
};

export const actions: Actions = {
	link: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const profile = String(form.get('steamId') ?? '');
		const authInput = String(form.get('authCode') ?? '').trim();
		const known = parseShareCode(String(form.get('knownCode') ?? ''));
		const existing = getSteamLink(db, user.id);
		const values = { steamId: profile, knownCode: String(form.get('knownCode') ?? '') };

		let steamId = parseSteamId(profile);
		const vanity = steamId ? null : vanityName(profile);
		const apiKey = getSteamApiKey(db);
		if (!steamId && vanity && apiKey) steamId = await resolveVanity(apiKey, vanity);
		if (!steamId) {
			return fail(400, {
				action: 'link',
				values,
				message: 'Enter your SteamID64 (7656…) or a steamcommunity.com/profiles/… link'
			});
		}

		const authCode = authInput ? authInput.toUpperCase() : existing?.authCode;
		if (!authCode || !isAuthCode(authCode)) {
			return fail(400, {
				action: 'link',
				values,
				message: 'The auth code looks like AAAA-AAAAA-AAAA'
			});
		}
		if (!known) {
			return fail(400, {
				action: 'link',
				values,
				message: 'The match code looks like CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx'
			});
		}

		saveSteamLink(db, user.id, {
			steamId,
			authCode,
			knownCode: known.code,
			knownMatchId: known.matchId
		});
		requestValveCheck(db);
		return { action: 'link', ok: true };
	},

	unlink: ({ locals }) => {
		deleteSteamLink(db, locals.user!.id);
		return { action: 'unlink' };
	},

	check: () => {
		requestValveCheck(db);
		return { action: 'check', ok: true };
	},

	retry: async ({ request }) => {
		retryValveMatch(db, String((await request.formData()).get('matchId')));
		requestValveCheck(db);
		return { action: 'retry' };
	},

	apiKey: async ({ request, locals }) => {
		requireAdmin(locals.user);
		const key = String((await request.formData()).get('apiKey') ?? '')
			.trim()
			.toUpperCase();
		if (!/^[0-9A-F]{32}$/.test(key)) {
			return fail(400, {
				action: 'apiKey',
				message: 'A Steam Web API key is 32 characters, 0-9 and A-F'
			});
		}
		setSteamApiKey(db, key);
		requestValveCheck(db);
		return { action: 'apiKey', ok: true };
	},

	removeApiKey: ({ locals }) => {
		requireAdmin(locals.user);
		setSteamApiKey(db, null);
		return { action: 'apiKey' };
	},

	botStart: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const accountName = String(form.get('accountName') ?? '').trim();
		const password = String(form.get('password') ?? '');
		if (!accountName || !password) {
			return fail(400, { action: 'bot', message: 'Enter the bot account’s name and password' });
		}
		const state = await botLogins.start(admin.id, accountName, password);
		if (state.step === 'done') requestValveCheck(db);
		return { action: 'bot' };
	},

	botCode: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const state = await botLogins.submitCode(
			admin.id,
			String((await request.formData()).get('code') ?? '')
		);
		if (state.step === 'done') requestValveCheck(db);
		return { action: 'bot' };
	},

	botCancel: ({ locals }) => {
		botLogins.cancel(requireAdmin(locals.user).id);
		return { action: 'bot' };
	},

	botDisconnect: ({ locals }) => {
		botLogins.cancel(requireAdmin(locals.user).id);
		setSteamBot(db, null);
		return { action: 'bot' };
	}
};
