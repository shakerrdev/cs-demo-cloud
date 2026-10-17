import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export type TlsInfo =
	| { mode: 'off' | 'custom' }
	| { mode: 'local-ca'; name: string; fingerprint: string; expires: string };

export async function readLocalCa(): Promise<string | null> {
	const path = process.env.TLS_CA_PATH;
	if (process.env.TLS_MODE !== 'local-ca' || !path) return null;
	return readFile(path, 'utf8').catch(() => null);
}

export async function tlsInfo(): Promise<TlsInfo> {
	const mode = process.env.TLS_MODE;
	if (mode === 'custom') return { mode };
	const pem = await readLocalCa();
	if (!pem) return { mode: 'off' };
	const cert = new X509Certificate(pem);
	return {
		mode: 'local-ca',
		name: cert.subject.match(/CN=([^\n]+)/)?.[1] ?? 'cs-demo-cloud local CA',
		fingerprint: cert.fingerprint256,
		expires: new Date(cert.validTo).toISOString()
	};
}
