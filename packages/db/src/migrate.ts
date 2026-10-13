import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { databasePath, openDb } from './client.ts';

const path = databasePath();
const db = openDb(path);
migrate(db, { migrationsFolder: join(import.meta.dirname, '..', 'drizzle') });
db.$client.close();
console.log(`Migrated ${path}`);
