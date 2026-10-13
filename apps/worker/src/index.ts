import { setTimeout as sleep } from 'node:timers/promises';
import {
	claimNextDemo,
	completeDemo,
	failDemo,
	openDb,
	requeueStaleDemos,
	touchDemo
} from '@cs-demo-cloud/db';
import { createStorage } from '@cs-demo-cloud/shared';
import { removeOldFiles } from './housekeeping.ts';
import { processDemo, type WorkerContext } from './process-demo.ts';

const idleDelayMs = 1000;
const heartbeatMs = 10_000;
const staleAfterMs = 60_000;
const hour = 3_600_000;

const context: WorkerContext = {
	db: openDb(),
	storage: createStorage(),
	log: (message) => console.log(message)
};
const { db, storage } = context;
const shutdown = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => shutdown.abort());
}

const requeued = requeueStaleDemos(db, staleAfterMs);
if (requeued > 0) console.log(`Requeued ${requeued} interrupted demo(s)`);
await removeOldFiles(storage.workDir, hour);
await removeOldFiles(storage.uploadDir, 6 * hour);
console.log('Worker ready');

while (!shutdown.signal.aborted) {
	const demo = claimNextDemo(db);

	if (!demo) {
		await sleep(idleDelayMs, undefined, { signal: shutdown.signal }).catch(() => {});
		continue;
	}

	const heartbeat = setInterval(() => touchDemo(db, demo.id), heartbeatMs);
	try {
		await processDemo(demo, context);
		completeDemo(db, demo.id);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		failDemo(db, demo.id, message);
		console.error(`Failed ${demo.fileName}: ${message}`);
	} finally {
		clearInterval(heartbeat);
	}
}

db.$client.close();
