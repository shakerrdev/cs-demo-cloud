import { basename } from 'node:path';
import {
	getSteamApiKey,
	getSteamBot,
	listPendingValveMatches,
	registerDemo,
	setSteamBot,
	setValveStatus,
	updateValveMatch,
	type Db
} from '@cs-demo-cloud/db';
import type { Storage } from '@cs-demo-cloud/shared';
import { collectShareCodes } from './collect.ts';
import { DemoUnavailableError, downloadDemo } from './download.ts';
import {
	connectGameCoordinator,
	type ConnectOptions,
	type GameCoordinator
} from './game-coordinator.ts';

export interface CycleOptions {
	db: Db;
	storage: Storage;
	log?: (message: string) => void;
	fetch?: typeof fetch;
	connect?: (options: ConnectOptions) => Promise<GameCoordinator>;
	batchSize?: number;
	delayMs?: number;
}

export interface CycleResult {
	found: number;
	imported: number;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runValveCycle({
	db,
	storage,
	log = () => {},
	fetch: fetchImpl = fetch,
	connect = connectGameCoordinator,
	batchSize = 10,
	delayMs
}: CycleOptions): Promise<CycleResult> {
	const status = {
		lastRunAt: Date.now(),
		lastError: null as string | null,
		botError: null as string | null
	};
	const result: CycleResult = { found: 0, imported: 0 };

	try {
		const apiKey = getSteamApiKey(db);
		if (apiKey)
			result.found = await collectShareCodes({ db, apiKey, fetch: fetchImpl, log, delayMs });

		const pending = listPendingValveMatches(db, batchSize);
		if (pending.length === 0) return result;

		let gc: GameCoordinator | null = null;
		const gameCoordinator = async () => {
			if (gc) return gc;
			const bot = getSteamBot(db);
			if (!bot) throw new Error('No Steam bot account is connected');
			gc = await connect({
				refreshToken: bot.refreshToken,
				onRefreshToken: (refreshToken) => setSteamBot(db, { ...bot, refreshToken }),
				log
			});
			return gc;
		};

		try {
			for (const match of pending) {
				let url = match.demoUrl;
				let matchTime = match.matchTime;
				try {
					if (!url) {
						if (status.botError) continue;
						let coordinator: GameCoordinator;
						try {
							coordinator = await gameCoordinator();
						} catch (error) {
							status.botError = message(error);
							log(`Game Coordinator: ${status.botError}`);
							continue;
						}
						const demo = await coordinator.lookup(match.shareCode);
						if (!demo) {
							updateValveMatch(db, match.matchId, {
								status: 'unavailable',
								error: 'Valve has no demo for this match anymore'
							});
							continue;
						}
						url = demo.url;
						matchTime = demo.matchTime;
						updateValveMatch(db, match.matchId, { demoUrl: url, matchTime });
					}

					const incoming = await downloadDemo(url, storage, fetchImpl);
					const { demo } = await registerDemo(db, storage, incoming, {
						fileName: basename(new URL(url).pathname),
						fileModifiedAt: matchTime,
						source: 'valve',
						uploadedBy: match.foundBy
					});
					updateValveMatch(db, match.matchId, { status: 'done', demoId: demo.id, error: null });
					result.imported++;
					log(`Imported match ${match.matchId} from Valve`);
				} catch (error) {
					if (error instanceof DemoUnavailableError) {
						updateValveMatch(db, match.matchId, { status: 'unavailable', error: error.message });
					} else {
						updateValveMatch(db, match.matchId, { failedAttempt: true, error: message(error) });
						log(`Match ${match.matchId}: ${message(error)}`);
					}
				}
			}
		} finally {
			await (gc as GameCoordinator | null)?.close().catch(() => {});
		}
	} catch (error) {
		status.lastError = message(error);
		log(`Valve check failed: ${status.lastError}`);
	} finally {
		setValveStatus(db, status);
	}

	return result;
}
