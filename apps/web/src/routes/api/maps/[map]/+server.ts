import { error } from '@sveltejs/kit';
import { isMapName, removeMapPack } from '@cs-demo-cloud/shared';
import { storage } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (locals.user?.role !== 'admin') error(403, 'Only admins can remove 3D maps');
	if (!isMapName(params.map) || !(await removeMapPack(storage, params.map)))
		error(404, '3D map not found');
	return new Response(null, { status: 204 });
};
