import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { openDb, type Db } from './client.ts';
import { createDemo, failDemo, getDemo, requeueAllDemos, requeueDemo } from './demos.ts';
import { runMigrations } from './migrations.ts';
import { demos } from './schema.ts';
import { eq } from 'drizzle-orm';

let dir: string;
let db: Db;

before(() => {
	dir = mkdtempSync(join(tmpdir(), 'cs-demo-cloud-demos-'));
	db = openDb(join(dir, 'test.db'));
	runMigrations(db);
});

after(() => rmSync(dir, { recursive: true, force: true }));

const add = (sha256: string, status: 'queued' | 'processing' | 'ready' | 'failed') => {
	const demo = createDemo(db, { fileName: `${sha256}.dem`, fileSize: 1, sha256, source: 'upload' });
	db.update(demos).set({ status }).where(eq(demos.id, demo.id)).run();
	return demo.id;
};

test('parse again requeues a failed demo but leaves one being parsed alone', () => {
	const failed = add('a', 'ready');
	failDemo(db, failed, 'boom');
	const busy = add('b', 'processing');

	requeueDemo(db, failed);
	requeueDemo(db, busy);

	assert.equal(getDemo(db, failed)?.status, 'queued');
	assert.equal(getDemo(db, failed)?.error, null);
	assert.equal(getDemo(db, busy)?.status, 'processing');
});

test('parse all again requeues everything that is not being parsed', () => {
	const ready = add('c', 'ready');
	const busy = add('d', 'processing');

	const changed = requeueAllDemos(db);

	assert.ok(changed >= 1);
	assert.equal(getDemo(db, ready)?.status, 'queued');
	assert.equal(getDemo(db, busy)?.status, 'processing');
});
