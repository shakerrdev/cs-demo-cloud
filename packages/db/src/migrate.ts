import { databasePath, openDb } from './client.ts';
import { runMigrations } from './migrations.ts';

const path = databasePath();
const db = openDb(path);
runMigrations(db);
db.$client.close();
console.log(`Migrated ${path}`);
