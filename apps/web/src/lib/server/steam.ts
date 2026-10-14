import { createBotLogins } from './bot-login.ts';
import { db } from './db.ts';

export const botLogins = createBotLogins(db);

export async function resolveVanity(apiKey: string, name: string): Promise<string | null> {
	const url = new URL('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/');
	url.searchParams.set('key', apiKey);
	url.searchParams.set('vanityurl', name);
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!response.ok) return null;
		const body = (await response.json()) as { response?: { success?: number; steamid?: string } };
		return body.response?.success === 1 ? (body.response.steamid ?? null) : null;
	} catch {
		return null;
	}
}

export function maskSecret(value: string, visible = 4): string {
	return `••••${value.slice(-visible)}`;
}
