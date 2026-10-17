import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isLocalName, LocalCa, parseHosts } from '../../../tls.ts';

test('only local-looking names get certificates', () => {
	for (const name of ['obelix', 'nas.local', 'box.lan', 'pc.home.arpa', 'nas.tail1234.ts.net']) {
		assert.ok(isLocalName(name), name);
	}
	for (const name of ['example.com', 'google.com', 'a b', '']) {
		assert.ok(!isLocalName(name), name);
	}
	assert.ok(isLocalName('demos.example.com', ['demos.example.com']));
	assert.deepEqual(parseHosts(' 192.168.1.20, Obelix [::1]'), ['192.168.1.20', 'obelix', '::1']);
});

test('the local CA signs certificates for names and keeps its key', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'tls-'));
	try {
		const ca = new LocalCa(dir, ['192.168.1.20']);
		await ca.init();
		const caCert = new X509Certificate(readFileSync(ca.certPath));
		assert.ok(caCert.ca);
		await ca.contextFor('obelix');
		const leaf = new X509Certificate(readFileSync(join(dir, 'hosts', 'obelix.pem')));
		assert.equal(leaf.subjectAltName, 'DNS:obelix');
		assert.ok(leaf.checkIssued(caCert));
		assert.ok(leaf.verify(caCert.publicKey));
		await ca.defaultContext();
		const fallback = new X509Certificate(readFileSync(join(dir, 'hosts', '_default.pem')));
		assert.match(fallback.subjectAltName!, /IP Address:192\.168\.1\.20/);

		const again = new LocalCa(dir);
		await again.init();
		assert.equal(again.fingerprint(), ca.fingerprint());
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
