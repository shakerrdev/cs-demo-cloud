export type MatchHistoryErrorKind = 'auth' | 'known-code' | 'rate-limit' | 'temporary';

export class MatchHistoryError extends Error {
	readonly kind: MatchHistoryErrorKind;

	constructor(kind: MatchHistoryErrorKind, message: string) {
		super(message);
		this.kind = kind;
	}
}

export interface MatchHistoryQuery {
	apiKey: string;
	steamId: string;
	authCode: string;
	knownCode: string;
}

export type NextShareCode = { kind: 'next'; code: string } | { kind: 'latest' };

const endpoint = 'https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1';

export async function fetchNextShareCode(
	query: MatchHistoryQuery,
	fetchImpl: typeof fetch = fetch
): Promise<NextShareCode> {
	const url = new URL(endpoint);
	url.searchParams.set('key', query.apiKey);
	url.searchParams.set('steamid', query.steamId);
	url.searchParams.set('steamidkey', query.authCode);
	url.searchParams.set('knowncode', query.knownCode);

	let response: Response;
	try {
		response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
	} catch (cause) {
		throw new MatchHistoryError(
			'temporary',
			`Steam couldn't be reached (${(cause as Error).message})`
		);
	}

	switch (response.status) {
		case 200: {
			const body = (await response.json().catch(() => null)) as {
				result?: { nextcode?: string };
			} | null;
			const code = body?.result?.nextcode;
			if (!code || code === 'n/a') return { kind: 'latest' };
			return { kind: 'next', code };
		}
		case 202:
			return { kind: 'latest' };
		case 401:
		case 403:
			throw new MatchHistoryError('auth', 'Steam rejected the auth code or the Web API key');
		case 412:
			throw new MatchHistoryError(
				'known-code',
				'Steam no longer accepts the last match code. Enter your latest match code again.'
			);
		case 429:
		case 503:
			throw new MatchHistoryError(
				'rate-limit',
				`Steam is rate limiting requests (${response.status})`
			);
		default:
			throw new MatchHistoryError('temporary', `Steam answered ${response.status}`);
	}
}
