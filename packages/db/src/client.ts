import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { resolveDataDir } from '@cs-demo-cloud/shared';
import * as schema from './schema.ts';

export function databasePath(env: Record<string, string | undefined> = process.env): string {
	return env.DATABASE_PATH ? resolve(env.DATABASE_PATH) : join(resolveDataDir(env), 'app.db');
}

export function openDb(path = databasePath()) {
	mkdirSync(dirname(path), { recursive: true });
	const client = new Database(path);
	client.pragma('journal_mode = WAL');
	client.pragma('synchronous = NORMAL');
	client.pragma('busy_timeout = 5000');
	client.pragma('foreign_keys = ON');
	return drizzle({ client, schema });
}

export type Db = ReturnType<typeof openDb>;
