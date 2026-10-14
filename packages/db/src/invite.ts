import { dirname } from 'node:path';
import { runAsOwnerOf } from '@cs-demo-cloud/shared';
import { createInvite, databasePath, openDb } from './index.ts';

const role = process.argv.includes('--admin') ? 'admin' : 'member';
const path = databasePath();
runAsOwnerOf(dirname(path));
const db = openDb(path);
const { token, invite } = createInvite(db, { role });
db.$client.close();

const link = `/invite/${token}`;
console.log(
	`${role === 'admin' ? 'Admin' : 'Member'} invite, valid until ${invite.expiresAt.toISOString()}:`
);
console.log(
	process.env.ORIGIN
		? new URL(link, process.env.ORIGIN).href
		: `${link} (open it on your cs-demo-cloud address, e.g. http://localhost:3000${link})`
);
