import { and, asc, count, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import { createToken, hashPassword, hashToken, verifyPassword } from '@cs-demo-cloud/shared';
import type { Db } from './client.ts';
import { invites, sessions, users, type Role, type User } from './schema.ts';

const DAY = 86_400_000;
export const SESSION_TTL_MS = 30 * DAY;
const SESSION_REFRESH_BELOW_MS = 15 * DAY;
export const INVITE_TTL_MS = 7 * DAY;

export type SessionUser = Pick<User, 'id' | 'name' | 'role'>;

export class AuthError extends Error {}

let dummyHash: Promise<string> | null = null;

const sessionUser = (user: User): SessionUser => ({
	id: user.id,
	name: user.name,
	role: user.role
});

function validName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length < 2 || trimmed.length > 32)
		throw new AuthError('Names need 2 to 32 characters');
	if (!/^[\p{L}\p{N} ._-]+$/u.test(trimmed)) {
		throw new AuthError('Names can use letters, numbers, spaces, dots, dashes and underscores');
	}
	return trimmed;
}

function validPassword(password: string): string {
	if (password.length < 10) throw new AuthError('Passwords need at least 10 characters');
	if (password.length > 200) throw new AuthError('Passwords can have at most 200 characters');
	return password;
}

type Reader = Pick<Db, 'select'>;

function findUserByName(db: Reader, name: string): User | undefined {
	return db
		.select()
		.from(users)
		.where(sql`lower(${users.name}) = lower(${name.trim()})`)
		.get();
}

export function countUsers(db: Db): number {
	return db.select({ total: count() }).from(users).get()?.total ?? 0;
}

export function createInvite(
	db: Db,
	{
		role,
		createdBy = null,
		ttlMs = INVITE_TTL_MS
	}: { role: Role; createdBy?: string | null; ttlMs?: number }
) {
	const token = createToken();
	const invite = db
		.insert(invites)
		.values({ id: hashToken(token), role, createdBy, expiresAt: new Date(Date.now() + ttlMs) })
		.returning()
		.get();
	return { token, invite };
}

export function getOpenInvite(db: Reader, token: string) {
	return db
		.select()
		.from(invites)
		.where(
			and(
				eq(invites.id, hashToken(token)),
				isNull(invites.usedAt),
				gt(invites.expiresAt, new Date())
			)
		)
		.get();
}

export function removeBootstrapInvites(db: Db): void {
	db.delete(invites)
		.where(and(isNull(invites.createdBy), isNull(invites.usedAt)))
		.run();
}

export async function acceptInvite(
	db: Db,
	token: string,
	name: string,
	password: string
): Promise<SessionUser> {
	const cleanName = validName(name);
	const passwordHash = await hashPassword(validPassword(password));

	return db.transaction((tx) => {
		const invite = getOpenInvite(tx, token);
		if (!invite) throw new AuthError('This invite link is invalid, expired or already used');
		if (findUserByName(tx, cleanName)) throw new AuthError('That name is already taken');

		const user = tx
			.insert(users)
			.values({ name: cleanName, passwordHash, role: invite.role })
			.returning()
			.get();
		tx.update(invites)
			.set({ usedAt: new Date(), usedBy: user.id })
			.where(eq(invites.id, invite.id))
			.run();
		return sessionUser(user);
	});
}

export async function login(db: Db, name: string, password: string): Promise<SessionUser | null> {
	const user = findUserByName(db, name);
	if (!user) {
		dummyHash ??= hashPassword('not a real password');
		await verifyPassword(password, await dummyHash);
		return null;
	}
	return (await verifyPassword(password, user.passwordHash)) ? sessionUser(user) : null;
}

export function createSession(db: Db, userId: string) {
	const token = createToken();
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
	db.insert(sessions)
		.values({ id: hashToken(token), userId, expiresAt })
		.run();
	return { token, expiresAt };
}

export function getSession(db: Db, token: string) {
	const id = hashToken(token);
	const row = db
		.select({ session: sessions, user: users })
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.id, id))
		.get();
	if (!row) return null;

	const now = Date.now();
	if (row.session.expiresAt.getTime() <= now) {
		db.delete(sessions).where(eq(sessions.id, id)).run();
		return null;
	}

	let expiresAt = row.session.expiresAt;
	const refreshed = expiresAt.getTime() - now < SESSION_REFRESH_BELOW_MS;
	if (refreshed) {
		expiresAt = new Date(now + SESSION_TTL_MS);
		db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id)).run();
	}
	return { user: sessionUser(row.user), expiresAt, refreshed };
}

export function deleteSession(db: Db, token: string): void {
	db.delete(sessions)
		.where(eq(sessions.id, hashToken(token)))
		.run();
}

export function deleteExpiredSessions(db: Db): void {
	db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
}

export async function changePassword(
	db: Db,
	userId: string,
	currentToken: string,
	current: string,
	next: string
): Promise<void> {
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user || !(await verifyPassword(current, user.passwordHash))) {
		throw new AuthError('Your current password is wrong');
	}
	const passwordHash = await hashPassword(validPassword(next));
	db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
	db.delete(sessions)
		.where(and(eq(sessions.userId, userId), ne(sessions.id, hashToken(currentToken))))
		.run();
}

export function listUsers(db: Db) {
	return db
		.select({
			id: users.id,
			name: users.name,
			role: users.role,
			createdAt: users.createdAt,
			uploads: sql<number>`(select count(*) from demos where demos.uploaded_by = users.id)`
		})
		.from(users)
		.orderBy(asc(users.createdAt))
		.all();
}

export function listOpenInvites(db: Db) {
	return db
		.select({
			id: invites.id,
			role: invites.role,
			expiresAt: invites.expiresAt,
			createdAt: invites.createdAt,
			createdBy: users.name
		})
		.from(invites)
		.leftJoin(users, eq(users.id, invites.createdBy))
		.where(and(isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
		.orderBy(desc(invites.createdAt))
		.all();
}

export function revokeInvite(db: Db, id: string): void {
	db.delete(invites)
		.where(and(eq(invites.id, id), isNull(invites.usedAt)))
		.run();
}

export function deleteUser(db: Db, id: string): void {
	db.delete(users).where(eq(users.id, id)).run();
}
