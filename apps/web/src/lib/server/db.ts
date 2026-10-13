import { building } from '$app/env';
import { openDb, type Db } from '@cs-demo-cloud/db';

export const db: Db = building ? ({} as Db) : openDb();
