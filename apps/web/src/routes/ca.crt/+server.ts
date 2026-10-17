import { error } from '@sveltejs/kit';
import { readLocalCa } from '#lib/server/tls.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const pem = await readLocalCa();
	if (!pem) error(404, 'This server doesn’t use its own certificate authority');
	return new Response(pem, {
		headers: {
			'content-type': 'application/x-x509-ca-cert',
			'content-disposition': 'attachment; filename="cs-demo-cloud-ca.crt"',
			'cache-control': 'no-store'
		}
	});
};
