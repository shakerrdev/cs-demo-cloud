import { createInvite, openDb } from './index.ts';

const role = process.argv.includes('--admin') ? 'admin' : 'member';
const db = openDb();
const { token, invite } = createInvite(db, { role });
db.$client.close();

const origin = (process.env.ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '');
console.log(
	`${role === 'admin' ? 'Admin' : 'Member'} invite, valid until ${invite.expiresAt.toISOString()}:`
);
console.log(`${origin}/invite/${token}`);
