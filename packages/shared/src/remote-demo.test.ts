import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	RemoteDemoError,
	assertPublicHost,
	demoNameFromUrl,
	isPrivateAddress,
	parseDemoUrl
} from './remote-demo.ts';

test('private and public addresses', () => {
	for (const address of [
		'127.0.0.1',
		'10.1.2.3',
		'192.168.1.5',
		'172.20.0.1',
		'169.254.1.1',
		'::1',
		'fd00::1',
		'::ffff:192.168.0.1',
		'100.100.1.1'
	]) {
		assert.equal(isPrivateAddress(address), true, address);
	}
	for (const address of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) {
		assert.equal(isPrivateAddress(address), false, address);
	}
});

test('parses only http links without credentials', () => {
	assert.equal(parseDemoUrl(' https://a.example/x.dem.gz ').hostname, 'a.example');
	assert.throws(() => parseDemoUrl('file:///etc/passwd'), RemoteDemoError);
	assert.throws(() => parseDemoUrl('https://u:p@a.example/x'), RemoteDemoError);
	assert.throws(() => parseDemoUrl('nope'), RemoteDemoError);
});

test('names the demo after the link', () => {
	assert.equal(
		demoNameFromUrl(new URL('https://cdn.example/cs2/1-abc.dem.zst?sig=1')),
		'1-abc.dem.zst'
	);
	assert.equal(demoNameFromUrl(new URL('https://cdn.example/download?id=1')), 'demo.dem');
});

test('rejects hosts that resolve to private addresses', async () => {
	await assertPublicHost(new URL('https://cdn.example/'), async () => ['8.8.8.8']);
	await assert.rejects(
		assertPublicHost(new URL('https://evil.example/'), async () => ['8.8.8.8', '127.0.0.1']),
		RemoteDemoError
	);
	await assert.rejects(assertPublicHost(new URL('http://[::1]/')), RemoteDemoError);
	await assert.rejects(
		assertPublicHost(new URL('https://gone.example/'), async () => []),
		RemoteDemoError
	);
});
