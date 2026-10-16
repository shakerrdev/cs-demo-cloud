import { json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { listDemos } from '@cs-demo-cloud/db';
import { mergeCosmetics, type Cosmetics } from '@cs-demo-cloud/replay';
import { db } from '#lib/server/db.ts';
import { storage } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const sets = await Promise.all(
		listDemos(db)
			.filter(({ demo }) => demo.status === 'ready')
			.map(async ({ demo }) => {
				try {
					return JSON.parse(await readFile(storage.cosmeticsPath(demo.id), 'utf8')) as Cosmetics;
				} catch {
					return { agents: [], paints: [] };
				}
			})
	);
	const headers: Record<string, string> = {};
	if (url.searchParams.has('download'))
		headers['content-disposition'] = 'attachment; filename="cosmetics.json"';
	return json(mergeCosmetics(sets), { headers });
};
