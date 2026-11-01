import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class RemoteDemoError extends Error {}

export function isPrivateAddress(address: string): boolean {
	const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
	if (isIP(v4) === 4) {
		const [a = 0, b = 0] = v4.split('.').map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a >= 224
		);
	}
	const v6 = address.toLowerCase();
	return (
		v6 === '::' ||
		v6 === '::1' ||
		v6.startsWith('fc') ||
		v6.startsWith('fd') ||
		v6.startsWith('fe8') ||
		v6.startsWith('fe9') ||
		v6.startsWith('fea') ||
		v6.startsWith('feb')
	);
}

export function parseDemoUrl(input: string): URL {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		throw new RemoteDemoError('That is not a valid link');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new RemoteDemoError('Only http and https links can be imported');
	}
	if (url.username || url.password)
		throw new RemoteDemoError('Links with credentials are not allowed');
	return url;
}

export function demoNameFromUrl(url: URL): string {
	const last = decodeURIComponent(url.pathname.split('/').pop() ?? '').trim();
	return last && /\.dem(\.(bz2|gz|zst))?$/i.test(last) ? last : 'demo.dem';
}

export async function assertPublicHost(
	url: URL,
	resolve: (host: string) => Promise<string[]> = async (host) =>
		(await lookup(host, { all: true })).map((entry) => entry.address)
): Promise<void> {
	const host = url.hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
	if (addresses.length === 0) throw new RemoteDemoError(`Could not find ${host}`);
	if (addresses.some(isPrivateAddress)) {
		throw new RemoteDemoError('Links to local or private addresses are not allowed');
	}
}
