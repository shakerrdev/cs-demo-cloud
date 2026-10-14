import type { EventEmitter } from 'node:events';
import { EAuthSessionGuardType, EAuthTokenPlatformType, LoginSession } from 'steam-session';
import { setSteamBot, type Db } from '@cs-demo-cloud/db';

export type BotLoginState =
	| { step: 'code'; guard: 'email' | 'app'; detail: string | null; wrongCode: boolean }
	| { step: 'confirm' }
	| { step: 'done'; accountName: string }
	| { step: 'error'; message: string };

export interface BotSession extends EventEmitter {
	loginTimeout: number;
	readonly accountName: string;
	readonly refreshToken: string;
	readonly steamID: { getSteamID64(): string };
	startWithCredentials(details: { accountName: string; password: string }): Promise<{
		actionRequired: boolean;
		validActions?: { type: number; detail?: string }[];
	}>;
	submitSteamGuardCode(code: string): Promise<void>;
	cancelLoginAttempt(): boolean;
}

interface Attempt {
	session: BotSession;
	state: BotLoginState;
	startedAt: number;
}

const ATTEMPT_TTL_MS = 10 * 60_000;

const loginErrors: Record<string, string> = {
	InvalidPassword: 'Wrong account name or password',
	RateLimitExceeded: 'Steam is rate limiting login attempts. Wait a while and try again.',
	AccountLoginDeniedThrottle: 'Steam is rate limiting login attempts. Wait a while and try again.',
	InvalidLoginAuthCode: 'That Steam Guard code is wrong',
	TwoFactorCodeMismatch: 'That Steam Guard code is wrong',
	Expired: 'The code expired. Start again.'
};

function describe(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return loginErrors[message] ?? `Steam login failed: ${message}`;
}

export function createBotLogins(
	db: Db,
	createSession: () => BotSession = () =>
		new LoginSession(EAuthTokenPlatformType.SteamClient) as BotSession
) {
	const attempts = new Map<string, Attempt>();

	const prune = () => {
		for (const [key, attempt] of attempts) {
			if (Date.now() - attempt.startedAt > ATTEMPT_TTL_MS) {
				attempt.session.cancelLoginAttempt();
				attempts.delete(key);
			}
		}
	};

	const watch = (attempt: Attempt) => {
		attempt.session.on('authenticated', () => {
			setSteamBot(db, {
				accountName: attempt.session.accountName,
				steamId: attempt.session.steamID.getSteamID64(),
				refreshToken: attempt.session.refreshToken
			});
			attempt.state = { step: 'done', accountName: attempt.session.accountName };
		});
		attempt.session.on('timeout', () => {
			attempt.state = { step: 'error', message: 'The login wasn’t approved in time. Start again.' };
		});
		attempt.session.on('error', (error: unknown) => {
			attempt.state = { step: 'error', message: describe(error) };
		});
	};

	return {
		state(key: string): BotLoginState | null {
			prune();
			return attempts.get(key)?.state ?? null;
		},

		async start(key: string, accountName: string, password: string): Promise<BotLoginState> {
			prune();
			attempts.get(key)?.session.cancelLoginAttempt();
			const session = createSession();
			session.loginTimeout = 3 * 60_000;
			const attempt: Attempt = { session, state: { step: 'confirm' }, startedAt: Date.now() };
			attempts.set(key, attempt);
			watch(attempt);

			try {
				const started = await session.startWithCredentials({ accountName, password });
				if (attempt.state.step === 'done') return attempt.state;
				const actions = started.actionRequired ? (started.validActions ?? []) : [];
				const code = actions.find(
					(a) =>
						a.type === EAuthSessionGuardType.DeviceCode ||
						a.type === EAuthSessionGuardType.EmailCode
				);
				if (code) {
					attempt.state = {
						step: 'code',
						guard: code.type === EAuthSessionGuardType.EmailCode ? 'email' : 'app',
						detail: code.detail ?? null,
						wrongCode: false
					};
				}
			} catch (error) {
				attempt.state = { step: 'error', message: describe(error) };
			}
			return attempt.state;
		},

		async submitCode(key: string, code: string): Promise<BotLoginState> {
			const attempt = attempts.get(key);
			const waiting = attempt?.state;
			if (!attempt || waiting?.step !== 'code') {
				return { step: 'error', message: 'No login is waiting for a code. Start again.' };
			}
			try {
				await attempt.session.submitSteamGuardCode(code.trim());
				if (attempt.state.step === 'code') attempt.state = { step: 'confirm' };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (message === 'InvalidLoginAuthCode' || message === 'TwoFactorCodeMismatch') {
					attempt.state = { ...waiting, wrongCode: true };
				} else {
					attempt.state = { step: 'error', message: describe(error) };
				}
			}
			return attempt.state;
		},

		cancel(key: string): void {
			attempts.get(key)?.session.cancelLoginAttempt();
			attempts.delete(key);
		}
	};
}

export type BotLogins = ReturnType<typeof createBotLogins>;

export function refreshTokenExpiry(token: string): Date | null {
	try {
		const payload = JSON.parse(
			Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')
		) as {
			exp?: number;
		};
		return payload.exp ? new Date(payload.exp * 1000) : null;
	} catch {
		return null;
	}
}
