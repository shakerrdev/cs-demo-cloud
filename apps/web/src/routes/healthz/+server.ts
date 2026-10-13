import { countUsers } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	countUsers(db);
	return new Response('ok', { headers: { 'cache-control': 'no-store' } });
};
