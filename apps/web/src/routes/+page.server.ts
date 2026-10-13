import { listDemos } from '@cs-demo-cloud/db';
import { db } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return { demos: listDemos(db) };
};
