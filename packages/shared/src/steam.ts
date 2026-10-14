import { decodeMatchShareCode } from 'csgo-sharecode';

export interface ShareCode {
	code: string;
	matchId: string;
}

export function parseShareCode(input: string): ShareCode | null {
	const code = input.trim().replace(/^steam:\/\/rungame\/730\/\d+\/\+csgo_download_match%20/i, '');
	if (!/^CSGO(-[A-Za-z0-9]{5}){5}$/.test(code)) return null;
	try {
		return { code, matchId: decodeMatchShareCode(code).matchId.toString() };
	} catch {
		return null;
	}
}

export function isAuthCode(input: string): boolean {
	return /^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/.test(input.trim().toUpperCase());
}

const steamId64 = /^7656119\d{10}$/;

export function parseSteamId(input: string): string | null {
	const value = input.trim();
	if (steamId64.test(value)) return value;
	const match = /steamcommunity\.com\/profiles\/(\d{17})/.exec(value);
	return match && steamId64.test(match[1]!) ? match[1]! : null;
}

export function vanityName(input: string): string | null {
	return /steamcommunity\.com\/id\/([\w-]{2,32})/.exec(input.trim())?.[1] ?? null;
}
