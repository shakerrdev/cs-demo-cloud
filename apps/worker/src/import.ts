import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { openDb, registerDemo } from '@cs-demo-cloud/db';
import { createStorage, receiveDemo } from '@cs-demo-cloud/shared';

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error('Usage: pnpm import <demo files...>');
	process.exit(1);
}

const db = openDb();
const storage = createStorage();
let failed = 0;

for (const file of files) {
	const path = resolve(file);
	try {
		const { mtime } = await stat(path);
		const incoming = await receiveDemo(storage, createReadStream(path));
		const { demo, duplicate } = await registerDemo(db, storage, incoming, {
			fileName: basename(path),
			fileModifiedAt: mtime,
			source: 'upload'
		});
		console.log(`${duplicate ? 'Already imported' : 'Queued'} ${basename(path)} (${demo.id})`);
	} catch (error) {
		failed++;
		console.error(`Skipped ${basename(path)}: ${error instanceof Error ? error.message : error}`);
	}
}

db.$client.close();
process.exitCode = failed > 0 ? 1 : 0;
