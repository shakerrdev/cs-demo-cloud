import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachment, exportFileName } from './export.ts';

test('names the playable export .dem whatever the stored format', () => {
	assert.equal(exportFileName('match730_003.dem.bz2', 'bz2', false), 'match730_003.dem');
	assert.equal(exportFileName('scrim.dem', 'dem', false), 'scrim.dem');
	assert.equal(exportFileName('faceit.DEM.ZST', 'zst', false), 'faceit.dem');
});

test('keeps the stored compression for the original file', () => {
	assert.equal(exportFileName('match.dem.gz', 'gz', true), 'match.dem.gz');
	assert.equal(exportFileName('upload', 'bz2', true), 'upload.dem.bz2');
	assert.equal(exportFileName('match.dem', 'dem', true), 'match.dem');
});

test('strips paths and characters that break file names', () => {
	assert.equal(exportFileName('C:\\demos\\a:b?.dem', 'dem', false), 'a_b_.dem');
	assert.equal(exportFileName('.dem', 'dem', false), 'demo.dem');
});

test('quotes non-ASCII names for every browser', () => {
	assert.equal(
		attachment('müller.dem'),
		`attachment; filename="m_ller.dem"; filename*=UTF-8''m%C3%BCller.dem`
	);
});
