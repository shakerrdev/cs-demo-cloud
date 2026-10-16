import { error } from '@sveltejs/kit';
import { removeDemo } from '#lib/server/demos.ts';
import { isDemoId } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!isDemoId(params.id)) error(404, 'Demo not found');
	const result = await removeDemo(locals.user, params.id);
	if (result === 'missing') error(404, 'Demo not found');
	if (result === 'forbidden') error(403, 'Only admins and the uploader can delete this demo');
	if (result === 'busy') error(409, 'The demo is being parsed right now; try again in a moment');
	return new Response(null, { status: 204 });
};
