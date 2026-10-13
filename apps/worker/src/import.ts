import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { openDb, registerDemo } from '@cs-demo-cloud/db';
import { createStorage, receiveDemo } from '@cs-demo-cloud/shared';

const demoFile = /\.(dem|bz2|gz|zst)$/i;

async function expand(target: string): Promise<string[]> {
	const path = resolve(target);
	const info = await stat(path);
	if (!info.isDirectory()) return [path];
	const names = await readdir(path);
	return names
		.filter((name) => demoFile.test(name))
		.sort()
		.map((name) => join(path, name));
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
	console.error('Usage: pnpm demos:import <demo files or folders...>');
	process.exit(1);
}

const db = openDb();
const storage = createStorage();
let queued = 0;
let known = 0;
let failed = 0;

for (const target of targets) {
	const files = await expand(target).catch((error: Error) => {
		failed++;
		console.error(`Skipped ${target}: ${error.message}`);
		return [];
	});
	for (const path of files) {
		try {
			const { mtime } = await stat(path);
			const incoming = await receiveDemo(storage, createReadStream(path));
			const { demo, duplicate } = await registerDemo(db, storage, incoming, {
				fileName: basename(path),
				fileModifiedAt: mtime,
				source: 'upload'
			});
			if (duplicate) known++;
			else queued++;
			console.log(`${duplicate ? 'Already imported' : 'Queued'} ${basename(path)} (${demo.id})`);
		} catch (error) {
			failed++;
			console.error(`Skipped ${basename(path)}: ${error instanceof Error ? error.message : error}`);
		}
	}
}

db.$client.close();
console.log(`${queued} queued, ${known} already imported, ${failed} skipped`);
process.exitCode = failed > 0 ? 1 : 0;
