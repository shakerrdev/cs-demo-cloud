import { error, fail } from '@sveltejs/kit';
import {
	AuthError,
	changePassword,
	createApiToken,
	createInvite,
	deleteUser,
	listApiTokens,
	listOpenInvites,
	listUsers,
	revokeApiToken,
	revokeInvite,
	roles,
	type Role,
	type SessionUser
} from '@cs-demo-cloud/db';
import { listMapPacks } from '@cs-demo-cloud/shared';
import { db } from '#lib/server/db.ts';
import { SESSION_COOKIE } from '#lib/server/session.ts';
import { storage } from '#lib/server/storage.ts';
import { tlsInfo } from '#lib/server/tls.ts';
import type { Actions, PageServerLoad } from './$types';

function requireAdmin(user: SessionUser | null): SessionUser {
	if (user?.role !== 'admin') error(403, 'Only admins can do that');
	return user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const admin = locals.user?.role === 'admin';
	return {
		users: admin ? listUsers(db) : [],
		invites: admin ? listOpenInvites(db) : [],
		tokens: listApiTokens(db, locals.user!.id),
		mapPacks: await listMapPacks(storage),
		tls: await tlsInfo()
	};
};

export const actions: Actions = {
	password: async ({ request, locals, cookies }) => {
		const form = await request.formData();
		const next = String(form.get('next') ?? '');
		if (next !== String(form.get('confirm') ?? '')) {
			return fail(400, { action: 'password', ok: false, message: 'The new passwords don’t match' });
		}
		try {
			await changePassword(
				db,
				locals.user!.id,
				cookies.get(SESSION_COOKIE)!,
				String(form.get('current') ?? ''),
				next
			);
		} catch (cause) {
			if (cause instanceof AuthError) {
				return fail(400, { action: 'password', ok: false, message: cause.message });
			}
			throw cause;
		}
		return {
			action: 'password',
			ok: true,
			message: 'Password changed. Other devices were signed out.'
		};
	},

	token: async ({ request, locals }) => {
		const name = String((await request.formData()).get('name') ?? '');
		try {
			const { token } = createApiToken(db, locals.user!.id, name);
			return { action: 'token', token };
		} catch (cause) {
			if (cause instanceof AuthError) return fail(400, { action: 'token', message: cause.message });
			throw cause;
		}
	},

	revokeToken: async ({ request, locals }) => {
		revokeApiToken(db, locals.user!.id, String((await request.formData()).get('id')));
		return { action: 'revokeToken' };
	},

	invite: async ({ request, locals, url }) => {
		const admin = requireAdmin(locals.user);
		const role = String((await request.formData()).get('role'));
		if (!roles.includes(role as Role))
			return fail(400, { action: 'invite', message: 'Unknown role' });
		const { token, invite } = createInvite(db, { role: role as Role, createdBy: admin.id });
		return { action: 'invite', link: `${url.origin}/invite/${token}`, role: invite.role };
	},

	revoke: async ({ request, locals }) => {
		requireAdmin(locals.user);
		revokeInvite(db, String((await request.formData()).get('id')));
		return { action: 'revoke' };
	},

	remove: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const id = String((await request.formData()).get('id'));
		if (id === admin.id)
			return fail(400, { action: 'remove', message: 'You can’t remove yourself' });
		deleteUser(db, id);
		return { action: 'remove' };
	}
};
