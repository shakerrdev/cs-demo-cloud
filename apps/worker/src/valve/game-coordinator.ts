import type { EventEmitter } from 'node:events';
import GlobalOffensive from 'globaloffensive';
import SteamUser from 'steam-user';
import { parseShareCode } from '@cs-demo-cloud/shared';

const CS2 = 730;

export interface MatchDemo {
	url: string;
	matchTime: Date | null;
}

export interface GameCoordinator {
	lookup(shareCode: string): Promise<MatchDemo | null>;
	close(): Promise<void>;
}

export interface SteamClient extends EventEmitter {
	logOn(details: { refreshToken: string }): void;
	logOff(): void;
	gamesPlayed(apps: number[]): void;
	requestFreeLicense(appIds: number[]): Promise<unknown>;
}

export interface CsClient extends EventEmitter {
	requestGame(shareCode: string): void;
}

interface RawMatch {
	matchid?: string | null;
	matchtime?: number | null;
	roundstatsall?: { map?: string | null }[] | null;
}

export interface SteamLibrary {
	createSteamClient(): SteamClient;
	createCsClient(steam: SteamClient): CsClient;
}

const steamLibrary: SteamLibrary = {
	createSteamClient: () =>
		new SteamUser({
			autoRelogin: false,
			renewRefreshTokens: true,
			dataDirectory: null
		}) as SteamClient,
	createCsClient: (steam) => new GlobalOffensive(steam) as CsClient
};

export interface ConnectOptions {
	refreshToken: string;
	onRefreshToken?: (token: string) => void;
	log?: (message: string) => void;
	timeoutMs?: number;
	lookupTimeoutMs?: number;
	library?: SteamLibrary;
}

const friendlyErrors: Record<string, string> = {
	AccessDenied: 'Steam refused the bot login. Connect the bot account again in Settings.',
	Expired: 'The bot login expired. Connect the bot account again in Settings.',
	LoggedInElsewhere: 'The bot account is logged in somewhere else.',
	RateLimitExceeded: 'Steam is rate limiting logins. Try again later.'
};

function describe(error: unknown): Error {
	const message = error instanceof Error ? error.message : String(error);
	return new Error(friendlyErrors[message] ?? `Steam login failed: ${message}`);
}

function withTimeout<T>(
	ms: number,
	message: string,
	run: (resolve: (value: T) => void, reject: (error: Error) => void) => () => void
) {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let cleanup: (() => void) | null = null;
		const finish = (settle: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			cleanup?.();
			settle();
		};
		const timer = setTimeout(() => finish(() => reject(new Error(message))), ms);
		cleanup = run(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error))
		);
		if (settled) cleanup();
	});
}

export async function connectGameCoordinator({
	refreshToken,
	onRefreshToken = () => {},
	log = () => {},
	timeoutMs = 60_000,
	lookupTimeoutMs = 30_000,
	library = steamLibrary
}: ConnectOptions): Promise<GameCoordinator> {
	const steam = library.createSteamClient();
	const cs = library.createCsClient(steam);
	steam.on('refreshToken', onRefreshToken);

	await withTimeout<void>(timeoutMs, 'Timed out logging in to Steam', (resolve, reject) => {
		const onError = (error: unknown) => reject(describe(error));
		const onLoggedOn = () => resolve();
		steam.once('error', onError);
		steam.once('loggedOn', onLoggedOn);
		steam.logOn({ refreshToken });
		return () => {
			steam.off('error', onError);
			steam.off('loggedOn', onLoggedOn);
		};
	});

	steam.on('error', (error: unknown) => log(describe(error).message));

	const close = async () => {
		steam.gamesPlayed([]);
		steam.logOff();
	};

	try {
		await steam.requestFreeLicense([CS2]).catch(() => {});
		await withTimeout<void>(
			timeoutMs,
			"Couldn't connect to the CS2 Game Coordinator",
			(resolve, reject) => {
				const onConnected = () => resolve();
				const onPlaying = (blocked: boolean) => {
					if (blocked) reject(new Error('The bot account is playing a game on another device.'));
				};
				cs.once('connectedToGC', onConnected);
				steam.on('playingState', onPlaying);
				steam.gamesPlayed([CS2]);
				return () => {
					cs.off('connectedToGC', onConnected);
					steam.off('playingState', onPlaying);
				};
			}
		);
	} catch (error) {
		await close();
		throw error;
	}

	return {
		lookup(shareCode) {
			const parsed = parseShareCode(shareCode);
			if (!parsed) return Promise.reject(new Error(`Invalid match code: ${shareCode}`));
			return withTimeout<MatchDemo | null>(
				lookupTimeoutMs,
				"The Game Coordinator didn't answer",
				(resolve) => {
					const onMatchList = (matches: RawMatch[] = []) => {
						const match = matches.find((m) => m.matchid === parsed.matchId);
						if (!match) return;
						const url = match.roundstatsall?.at(-1)?.map;
						resolve(
							url
								? { url, matchTime: match.matchtime ? new Date(match.matchtime * 1000) : null }
								: null
						);
					};
					cs.on('matchList', onMatchList);
					cs.requestGame(parsed.code);
					return () => cs.off('matchList', onMatchList);
				}
			);
		},
		close
	};
}
