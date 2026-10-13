import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.ts';

export function runMigrations(db: Db): void {
	migrate(db, { migrationsFolder: join(import.meta.dirname, '..', 'drizzle') });
}
