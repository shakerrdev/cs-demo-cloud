import { dirname } from 'node:path';
import { runAsOwnerOf } from '@cs-demo-cloud/shared';
import { databasePath, openDb } from './client.ts';
import { runMigrations } from './migrations.ts';

const path = databasePath();
runAsOwnerOf(dirname(path));
const db = openDb(path);
runMigrations(db);
db.$client.close();
console.log(`Migrated ${path}`);
