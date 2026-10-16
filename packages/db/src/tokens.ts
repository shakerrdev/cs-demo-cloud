import { and, desc, eq } from 'drizzle-orm';
import { createToken, hashToken } from '@cs-demo-cloud/shared';
import type { Db } from './client.ts';
import type { SessionUser } from './auth.ts';
import { AuthError } from './auth.ts';
import { apiTokens, users } from './schema.ts';

const PREFIX = 'cdc_';
const TOUCH_EVERY_MS = 60_000;
const MAX_TOKENS = 20;

export function isApiToken(value: string): boolean {
	return value.startsWith(PREFIX) && value.length > PREFIX.length + 20;
}

export function createApiToken(db: Db, userId: string, name: string) {
	const clean = name.trim();
	if (!clean || clean.length > 48) throw new AuthError('Token names need 1 to 48 characters');
	const existing = db
		.select({ id: apiTokens.id })
		.from(apiTokens)
		.where(eq(apiTokens.userId, userId))
		.all();
	if (existing.length >= MAX_TOKENS)
		throw new AuthError(`You can have at most ${MAX_TOKENS} tokens`);
	const token = `${PREFIX}${createToken()}`;
	const row = db
		.insert(apiTokens)
		.values({ id: hashToken(token), userId, name: clean, hint: token.slice(-4) })
		.returning()
		.get();
	return { token, row };
}

export function listApiTokens(db: Db, userId: string) {
	return db
		.select({
			id: apiTokens.id,
			name: apiTokens.name,
			hint: apiTokens.hint,
			lastUsedAt: apiTokens.lastUsedAt,
			createdAt: apiTokens.createdAt
		})
		.from(apiTokens)
		.where(eq(apiTokens.userId, userId))
		.orderBy(desc(apiTokens.createdAt))
		.all();
}

export function revokeApiToken(db: Db, userId: string, id: string): boolean {
	return (
		db
			.delete(apiTokens)
			.where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
			.run().changes > 0
	);
}

export function getApiTokenUser(db: Db, token: string): SessionUser | null {
	if (!isApiToken(token)) return null;
	const id = hashToken(token);
	const row = db
		.select({ token: apiTokens, user: users })
		.from(apiTokens)
		.innerJoin(users, eq(users.id, apiTokens.userId))
		.where(eq(apiTokens.id, id))
		.get();
	if (!row) return null;
	const now = Date.now();
	if (!row.token.lastUsedAt || now - row.token.lastUsedAt.getTime() > TOUCH_EVERY_MS)
		db.update(apiTokens)
			.set({ lastUsedAt: new Date(now) })
			.where(eq(apiTokens.id, id))
			.run();
	return { id: row.user.id, name: row.user.name, role: row.user.role };
}
