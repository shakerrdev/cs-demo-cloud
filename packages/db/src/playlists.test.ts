import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { openDb, type Db } from './client.ts';
import { createDemo, deleteDemo } from './demos.ts';
import { runMigrations } from './migrations.ts';
import {
	addBookmark,
	createPlaylist,
	deleteBookmark,
	deletePlaylist,
	getPlaylist,
	listDemoBookmarks,
	listPlaylists,
	renamePlaylist,
	updateBookmarkNote
} from './playlists.ts';

let dir: string;
let db: Db;

before(() => {
	dir = mkdtempSync(join(tmpdir(), 'cs-demo-cloud-playlists-'));
	db = openDb(join(dir, 'test.db'));
	runMigrations(db);
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('playlists hold bookmarks in the order they were added', () => {
	const demo = createDemo(db, { fileName: 'a.dem', fileSize: 1, sha256: 'pl1', source: 'upload' });
	const list = createPlaylist(db, '  Anti-eco mistakes ', null);
	assert.equal(list.name, 'Anti-eco mistakes');
	assert.throws(() => createPlaylist(db, '   ', null));

	const first = addBookmark(db, {
		playlistId: list.id,
		demoId: demo.id,
		round: 7,
		tick: 900,
		note: ' late rotate ',
		createdBy: null
	});
	addBookmark(db, {
		playlistId: list.id,
		demoId: demo.id,
		round: 2,
		tick: 100,
		note: '',
		createdBy: null
	});

	const loaded = getPlaylist(db, list.id)!;
	assert.deepEqual(
		loaded.items.map((i) => [i.round, i.note]),
		[
			[7, 'late rotate'],
			[2, '']
		]
	);
	assert.equal(listPlaylists(db).find((p) => p.id === list.id)?.count, 2);
	assert.deepEqual(
		listDemoBookmarks(db, demo.id).map((b) => b.round),
		[2, 7]
	);

	updateBookmarkNote(db, first.id, 'rotated too late');
	renamePlaylist(db, list.id, 'Anti-ecos');
	assert.equal(getPlaylist(db, list.id)!.items[0]!.note, 'rotated too late');
	assert.equal(getPlaylist(db, list.id)!.name, 'Anti-ecos');

	deleteBookmark(db, first.id);
	assert.equal(getPlaylist(db, list.id)!.items.length, 1);
	deletePlaylist(db, list.id);
	assert.equal(getPlaylist(db, list.id), undefined);
	assert.equal(listDemoBookmarks(db, demo.id).length, 0);
});

test('deleting a demo removes its bookmarks', () => {
	const demo = createDemo(db, { fileName: 'b.dem', fileSize: 1, sha256: 'pl2', source: 'upload' });
	const list = createPlaylist(db, 'Clutches', null);
	addBookmark(db, {
		playlistId: list.id,
		demoId: demo.id,
		round: 1,
		tick: 1,
		note: '',
		createdBy: null
	});
	deleteDemo(db, demo.id);
	assert.equal(getPlaylist(db, list.id)!.items.length, 0);
});
