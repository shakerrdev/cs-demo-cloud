import { setTimeout as sleep } from 'node:timers/promises';
import {
	claimNextDemo,
	completeDemo,
	failDemo,
	openDb,
	requeueStaleDemos
} from '@cs-demo-cloud/db';
import { processDemo } from './process-demo.ts';

const idleDelayMs = 1000;

const db = openDb();
const shutdown = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => shutdown.abort());
}

const requeued = requeueStaleDemos(db);
if (requeued > 0) console.log(`Requeued ${requeued} interrupted demo(s)`);
console.log('Worker ready');

while (!shutdown.signal.aborted) {
	const demo = claimNextDemo(db);

	if (!demo) {
		await sleep(idleDelayMs, undefined, { signal: shutdown.signal }).catch(() => {});
		continue;
	}

	const startedAt = performance.now();
	try {
		await processDemo(demo);
		completeDemo(db, demo.id);
		console.log(`Processed ${demo.fileName} in ${Math.round(performance.now() - startedAt)}ms`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		failDemo(db, demo.id, message);
		console.error(`Failed ${demo.fileName}: ${message}`);
	}
}

db.$client.close();
