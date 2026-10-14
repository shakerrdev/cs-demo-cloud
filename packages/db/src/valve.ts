import { and, asc, desc, eq, lt } from 'drizzle-orm';
import type { Db } from './client.ts';
import {
	demos,
	settings,
	steamLinks,
	users,
	valveMatches,
	type SteamLink,
	type ValveMatch,
	type ValveMatchStatus
} from './schema.ts';

export const MAX_VALVE_ATTEMPTS = 5;

export interface SteamBot {
	accountName: string;
	steamId: string;
	refreshToken: string;
}

export interface ValveStatus {
	lastRunAt: number | null;
	lastError: string | null;
	botError: string | null;
}

function getSetting(db: Db, key: string): string | null {
	return (
		db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value ??
		null
	);
}

function setSetting(db: Db, key: string, value: string | null): void {
	if (value === null) {
		db.delete(settings).where(eq(settings.key, key)).run();
		return;
	}
	db.insert(settings)
		.values({ key, value, updatedAt: new Date() })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
		.run();
}

function readJson<T>(db: Db, key: string): T | null {
	const value = getSetting(db, key);
	if (!value) return null;
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

export function getSteamApiKey(db: Db): string | null {
	return getSetting(db, 'steam.apiKey');
}

export function setSteamApiKey(db: Db, key: string | null): void {
	setSetting(db, 'steam.apiKey', key);
}

export function getSteamBot(db: Db): SteamBot | null {
	return readJson<SteamBot>(db, 'steam.bot');
}

export function setSteamBot(db: Db, bot: SteamBot | null): void {
	setSetting(db, 'steam.bot', bot ? JSON.stringify(bot) : null);
}

export function getValveStatus(db: Db): ValveStatus {
	return (
		readJson<ValveStatus>(db, 'valve.status') ?? {
			lastRunAt: null,
			lastError: null,
			botError: null
		}
	);
}

export function setValveStatus(db: Db, status: ValveStatus): void {
	setSetting(db, 'valve.status', JSON.stringify(status));
}

export function requestValveCheck(db: Db): void {
	setSetting(db, 'valve.checkRequestedAt', String(Date.now()));
}

export function takeValveCheckRequest(db: Db): boolean {
	const requested = getSetting(db, 'valve.checkRequestedAt');
	if (requested) setSetting(db, 'valve.checkRequestedAt', null);
	return requested !== null;
}

export function getSteamLink(db: Db, userId: string): SteamLink | undefined {
	return db.select().from(steamLinks).where(eq(steamLinks.userId, userId)).get();
}

export function saveSteamLink(
	db: Db,
	userId: string,
	link: { steamId: string; authCode: string; knownCode: string; knownMatchId: string }
): void {
	db.transaction((tx) => {
		const values = {
			steamId: link.steamId,
			authCode: link.authCode,
			knownCode: link.knownCode,
			enabled: true,
			lastError: null
		};
		tx.insert(steamLinks)
			.values({ userId, ...values })
			.onConflictDoUpdate({ target: steamLinks.userId, set: values })
			.run();
		tx.insert(valveMatches)
			.values({ matchId: link.knownMatchId, shareCode: link.knownCode, foundBy: userId })
			.onConflictDoNothing()
			.run();
	});
}

export function deleteSteamLink(db: Db, userId: string): void {
	db.delete(steamLinks).where(eq(steamLinks.userId, userId)).run();
}

export function listEnabledSteamLinks(db: Db): SteamLink[] {
	return db.select().from(steamLinks).where(eq(steamLinks.enabled, true)).all();
}

export function updateSteamLink(
	db: Db,
	userId: string,
	changes: Partial<Pick<SteamLink, 'knownCode' | 'enabled' | 'lastCheckedAt' | 'lastError'>>
): void {
	db.update(steamLinks).set(changes).where(eq(steamLinks.userId, userId)).run();
}

export function queueValveMatch(
	db: Db,
	match: { matchId: string; shareCode: string; foundBy: string }
): boolean {
	return db.insert(valveMatches).values(match).onConflictDoNothing().run().changes > 0;
}

export function listPendingValveMatches(db: Db, limit: number): ValveMatch[] {
	return db
		.select()
		.from(valveMatches)
		.where(and(eq(valveMatches.status, 'pending'), lt(valveMatches.attempts, MAX_VALVE_ATTEMPTS)))
		.orderBy(asc(valveMatches.attempts), desc(valveMatches.createdAt))
		.limit(limit)
		.all();
}

export function updateValveMatch(
	db: Db,
	matchId: string,
	changes: Partial<Pick<ValveMatch, 'demoUrl' | 'matchTime' | 'demoId' | 'error'>> & {
		status?: ValveMatchStatus;
		failedAttempt?: boolean;
	}
): void {
	const { failedAttempt, ...rest } = changes;
	const current = db.select().from(valveMatches).where(eq(valveMatches.matchId, matchId)).get();
	if (!current) return;
	const attempts = current.attempts + (failedAttempt ? 1 : 0);
	db.update(valveMatches)
		.set({
			...rest,
			attempts,
			status: rest.status ?? (attempts >= MAX_VALVE_ATTEMPTS ? 'failed' : current.status),
			updatedAt: new Date()
		})
		.where(eq(valveMatches.matchId, matchId))
		.run();
}

export function retryValveMatch(db: Db, matchId: string): void {
	db.update(valveMatches)
		.set({ status: 'pending', attempts: 0, error: null, updatedAt: new Date() })
		.where(eq(valveMatches.matchId, matchId))
		.run();
}

export function listRecentValveMatches(db: Db, limit = 20) {
	return db
		.select({
			matchId: valveMatches.matchId,
			status: valveMatches.status,
			matchTime: valveMatches.matchTime,
			error: valveMatches.error,
			attempts: valveMatches.attempts,
			demoId: valveMatches.demoId,
			demoStatus: demos.status,
			foundBy: users.name,
			createdAt: valveMatches.createdAt
		})
		.from(valveMatches)
		.leftJoin(demos, eq(demos.id, valveMatches.demoId))
		.leftJoin(users, eq(users.id, valveMatches.foundBy))
		.orderBy(desc(valveMatches.createdAt))
		.limit(limit)
		.all();
}
