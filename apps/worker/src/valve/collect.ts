import { setTimeout as sleep } from 'node:timers/promises';
import {
	listEnabledSteamLinks,
	queueValveMatch,
	updateSteamLink,
	type Db
} from '@cs-demo-cloud/db';
import { parseShareCode } from '@cs-demo-cloud/shared';
import { MatchHistoryError, fetchNextShareCode } from './match-history.ts';

export interface CollectOptions {
	db: Db;
	apiKey: string;
	fetch?: typeof fetch;
	log?: (message: string) => void;
	maxPerLink?: number;
	delayMs?: number;
}

export async function collectShareCodes({
	db,
	apiKey,
	fetch: fetchImpl = fetch,
	log = () => {},
	maxPerLink = 30,
	delayMs = 1000
}: CollectOptions): Promise<number> {
	let total = 0;

	for (const link of listEnabledSteamLinks(db)) {
		let knownCode = link.knownCode;
		let found = 0;
		try {
			for (let i = 0; i < maxPerLink; i++) {
				const next = await fetchNextShareCode(
					{ apiKey, steamId: link.steamId, authCode: link.authCode, knownCode },
					fetchImpl
				);
				if (next.kind === 'latest') break;

				const parsed = parseShareCode(next.code);
				if (!parsed) throw new Error(`Steam returned an unexpected match code: ${next.code}`);
				if (
					queueValveMatch(db, {
						matchId: parsed.matchId,
						shareCode: parsed.code,
						foundBy: link.userId
					})
				)
					found++;
				knownCode = parsed.code;
				updateSteamLink(db, link.userId, { knownCode });
				if (delayMs > 0) await sleep(delayMs);
			}
			updateSteamLink(db, link.userId, { lastCheckedAt: new Date(), lastError: null });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stop =
				error instanceof MatchHistoryError &&
				(error.kind === 'auth' || error.kind === 'known-code');
			updateSteamLink(db, link.userId, {
				lastCheckedAt: new Date(),
				lastError: message,
				...(stop ? { enabled: false } : {})
			});
			log(`Match history for ${link.steamId}: ${message}`);
			if (error instanceof MatchHistoryError && error.kind === 'rate-limit') break;
		}

		if (found > 0) log(`Found ${found} new match(es) for ${link.steamId}`);
		total += found;
	}

	return total;
}
