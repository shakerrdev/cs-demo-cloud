import 'reflect-metadata';
import { webcrypto, randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { createSecureContext, type SecureContext } from 'node:tls';
import * as x509 from '@peculiar/x509';

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const subtle = webcrypto.subtle;
const algorithm: EcKeyGenParams & EcdsaParams = {
	name: 'ECDSA',
	namedCurve: 'P-256',
	hash: 'SHA-256'
};
const day = 24 * 60 * 60 * 1000;
const localSuffixes = [
	'.local',
	'.lan',
	'.home',
	'.home.arpa',
	'.internal',
	'.localdomain',
	'.ts.net'
];

function writeAtomic(path: string, data: string, mode = 0o644) {
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, data, { mode });
	renameSync(tmp, path);
}

function serial() {
	const bytes = randomBytes(16);
	bytes[0] &= 0x7f;
	return bytes.toString('hex');
}

async function exportKey(key: CryptoKey) {
	return x509.PemConverter.encode(await subtle.exportKey('pkcs8', key), 'PRIVATE KEY');
}

async function importKey(pem: string) {
	const der = x509.PemConverter.decode(pem)[0];
	return subtle.importKey('pkcs8', der, algorithm, true, ['sign']);
}

export function parseHosts(value: string | undefined): string[] {
	return (value ?? '')
		.split(/[\s,]+/)
		.map((host) =>
			host
				.trim()
				.toLowerCase()
				.replace(/^\[|\]$/g, '')
		)
		.filter(Boolean);
}

export function isLocalName(name: string, extra: string[] = []): boolean {
	const host = name.toLowerCase().replace(/\.$/, '');
	if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) return false;
	if (extra.includes(host) || host === 'localhost') return true;
	if (!host.includes('.')) return true;
	return localSuffixes.some((suffix) => host.endsWith(suffix));
}

export interface CertificateSource {
	contextFor(servername?: string): Promise<SecureContext>;
	defaultContext(): Promise<SecureContext>;
	defaultPem(): { key: string | Buffer; cert: string | Buffer };
}

export class LocalCa implements CertificateSource {
	dir: string;
	hosts: string[];
	contexts = new Map<string, SecureContext>();
	pending = new Map<string, Promise<SecureContext>>();
	key!: CryptoKey;
	cert!: x509.X509Certificate;
	fallback: SecureContext | undefined;
	fallbackAt = 0;

	constructor(dir: string, hosts: string[] = []) {
		this.dir = dir;
		this.hosts = hosts;
	}

	get certPath() {
		return join(this.dir, 'ca.crt');
	}

	async init() {
		mkdirSync(this.dir, { recursive: true, mode: 0o755 });
		mkdirSync(join(this.dir, 'hosts'), { recursive: true, mode: 0o700 });
		const keyPath = join(this.dir, 'ca.key');
		if (existsSync(keyPath) && existsSync(this.certPath)) {
			this.key = await importKey(readFileSync(keyPath, 'utf8'));
			this.cert = new x509.X509Certificate(readFileSync(this.certPath, 'utf8'));
			return;
		}
		const keys = await subtle.generateKey(algorithm, true, ['sign', 'verify']);
		const now = Date.now();
		const suffix = randomBytes(3).toString('hex');
		this.cert = await x509.X509CertificateGenerator.createSelfSigned({
			serialNumber: serial(),
			name: `CN=cs-demo-cloud local CA ${suffix}, O=cs-demo-cloud`,
			notBefore: new Date(now - day),
			notAfter: new Date(now + 3650 * day),
			keys,
			signingAlgorithm: algorithm,
			extensions: [
				new x509.BasicConstraintsExtension(true, 0, true),
				new x509.KeyUsagesExtension(
					x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
					true
				),
				await x509.SubjectKeyIdentifierExtension.create(keys.publicKey)
			]
		});
		this.key = keys.privateKey;
		writeAtomic(keyPath, await exportKey(keys.privateKey), 0o600);
		writeAtomic(this.certPath, this.cert.toString('pem'));
	}

	fingerprint() {
		return new X509Certificate(this.cert.toString('pem')).fingerprint256;
	}

	async issue(names: string[]) {
		const keys = await subtle.generateKey(algorithm, true, ['sign', 'verify']);
		const now = Date.now();
		const cert = await x509.X509CertificateGenerator.create({
			serialNumber: serial(),
			subject: `CN=${names[0]}`,
			issuer: this.cert.subject,
			notBefore: new Date(now - day),
			notAfter: new Date(now + 390 * day),
			signingKey: this.key,
			publicKey: keys.publicKey,
			signingAlgorithm: algorithm,
			extensions: [
				new x509.BasicConstraintsExtension(false, undefined, true),
				new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
				new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
				new x509.SubjectAlternativeNameExtension(
					names.map((value) => ({ type: isIP(value) ? ('ip' as const) : ('dns' as const), value }))
				),
				await x509.AuthorityKeyIdentifierExtension.create(this.cert.publicKey),
				await x509.SubjectKeyIdentifierExtension.create(keys.publicKey)
			]
		});
		return {
			key: await exportKey(keys.privateKey),
			cert: cert.toString('pem') + '\n' + this.cert.toString('pem') + '\n'
		};
	}

	async context(label: string, names: string[]): Promise<SecureContext> {
		const file = join(this.dir, 'hosts', `${label}.pem`);
		const wanted = [...names].sort().join(',');
		if (existsSync(file)) {
			const pem = readFileSync(file, 'utf8');
			const cert = new X509Certificate(pem);
			const san = (cert.subjectAltName ?? '')
				.split(', ')
				.map((entry) => entry.replace(/^(DNS|IP Address):/, '').toLowerCase())
				.sort()
				.join(',');
			const fresh = new Date(cert.validTo).getTime() - Date.now() > 30 * day;
			if (
				fresh &&
				san === wanted &&
				cert.checkIssued(new X509Certificate(this.cert.toString('pem')))
			) {
				return createSecureContext({ key: pem, cert: pem });
			}
		}
		const { key, cert } = await this.issue(names);
		writeAtomic(file, key + '\n' + cert, 0o600);
		return createSecureContext({ key, cert });
	}

	defaultNames() {
		return [...new Set(['localhost', '127.0.0.1', '::1', ...this.hosts])];
	}

	async defaultContext(): Promise<SecureContext> {
		if (!this.fallback || Date.now() - this.fallbackAt > day) {
			this.fallback = await this.context('_default', this.defaultNames());
			this.fallbackAt = Date.now();
			this.contexts.clear();
		}
		return this.fallback;
	}

	defaultPem() {
		const pem = readFileSync(join(this.dir, 'hosts', '_default.pem'), 'utf8');
		return { key: pem, cert: pem };
	}

	async contextFor(servername?: string): Promise<SecureContext> {
		const name = servername?.toLowerCase().replace(/\.$/, '');
		if (!name || !isLocalName(name, this.hosts)) return this.defaultContext();
		const cached = this.contexts.get(name);
		if (cached) return cached;
		let pending = this.pending.get(name);
		if (!pending) {
			pending = this.context(name, [name]).then((context) => {
				this.contexts.set(name, context);
				this.pending.delete(name);
				return context;
			});
			this.pending.set(name, pending);
		}
		return pending;
	}
}

class FileCertificate implements CertificateSource {
	certPath: string;
	keyPath: string;
	mtime = 0;
	checked = 0;
	secure!: SecureContext;

	constructor(certPath: string, keyPath: string) {
		this.certPath = certPath;
		this.keyPath = keyPath;
		this.load();
	}

	load() {
		this.mtime = statSync(this.certPath).mtimeMs + statSync(this.keyPath).mtimeMs;
		this.secure = createSecureContext({
			cert: readFileSync(this.certPath),
			key: readFileSync(this.keyPath)
		});
		this.checked = Date.now();
	}

	async contextFor() {
		if (Date.now() - this.checked > 60_000) {
			this.checked = Date.now();
			try {
				const mtime = statSync(this.certPath).mtimeMs + statSync(this.keyPath).mtimeMs;
				if (mtime !== this.mtime) this.load();
			} catch (error) {
				console.error('Could not reload the TLS certificate:', (error as Error).message);
			}
		}
		return this.secure;
	}

	async defaultContext(): Promise<SecureContext> {
		return this.contextFor();
	}

	defaultPem() {
		return { key: readFileSync(this.keyPath), cert: readFileSync(this.certPath) };
	}
}

export type Certificates =
	{ mode: 'custom'; source: CertificateSource } | { mode: 'local-ca'; source: LocalCa };

export async function createCertificates(
	env: Record<string, string | undefined>,
	dataDir: string
): Promise<Certificates> {
	if (env.TLS_CERT || env.TLS_KEY) {
		if (!env.TLS_CERT || !env.TLS_KEY) throw new Error('Set both TLS_CERT and TLS_KEY');
		return { mode: 'custom', source: new FileCertificate(env.TLS_CERT, env.TLS_KEY) };
	}
	const ca = new LocalCa(join(dataDir, 'tls'), parseHosts(env.TLS_HOSTS));
	await ca.init();
	await ca.defaultContext();
	return { mode: 'local-ca', source: ca };
}
