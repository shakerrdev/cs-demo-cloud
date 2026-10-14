import { setTimeout as sleep } from 'node:timers/promises';
import { openDb, takeValveCheckRequest } from '@cs-demo-cloud/db';
import { createStorage } from '@cs-demo-cloud/shared';
import { runValveCycle } from './valve/cycle.ts';

const intervalMs = Math.max(1, Number(process.env.VALVE_INTERVAL_MINUTES) || 10) * 60_000;
const pollMs = 5000;

const db = openDb();
const storage = createStorage();
const shutdown = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => shutdown.abort());
}

console.log(`Valve fetcher ready, checking every ${intervalMs / 60_000} min`);

let nextRun = Date.now() + 15_000;
while (!shutdown.signal.aborted) {
	if (takeValveCheckRequest(db) || Date.now() >= nextRun) {
		await runValveCycle({ db, storage, log: (message) => console.log(message) });
		nextRun = Date.now() + intervalMs;
	}
	await sleep(pollMs, undefined, { signal: shutdown.signal }).catch(() => {});
}

db.$client.close();
