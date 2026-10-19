import { error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { listDemos } from '@cs-demo-cloud/db';
import { uniqueZipNames, zipStream, zipStreamSize } from '@cs-demo-cloud/shared';
import { db } from '#lib/server/db.ts';
import { attachment, bulkEntryName, bulkZipName } from '#lib/server/export.ts';
import { isDemoId, storage } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

async function exportZip(ids: string[]): Promise<Response> {
	if (ids.some((id) => !isDemoId(id))) error(400, 'Unknown demo id');
	const wanted = ids.length ? new Set(ids) : null;
	const rows = listDemos(db)
		.filter(({ demo }) => !wanted || wanted.has(demo.id))
		.reverse();

	const found = await Promise.all(
		rows.map(async ({ demo, match }) => {
			const path = storage.demoPath(demo.id, demo.format);
			const file = await stat(path).catch(() => null);
			if (!file?.isFile()) return null;
			const date = demo.fileModifiedAt ?? demo.createdAt;
			return {
				name: bulkEntryName(demo.fileName, demo.format, date, match?.map ?? null),
				path,
				size: file.size,
				modified: date
			};
		})
	);
	const files = found.filter((file) => file !== null);
	if (!files.length) error(404, 'No demo files to export');
	const names = uniqueZipNames(files.map((file) => file.name));
	const entries = files.map((file, i) => ({ ...file, name: names[i]! }));

	return new Response(Readable.toWeb(zipStream(entries)) as ReadableStream, {
		headers: {
			'content-type': 'application/zip',
			'content-length': String(zipStreamSize(entries)),
			'content-disposition': attachment(bulkZipName(entries.length)),
			'cache-control': 'private, no-store'
		}
	});
}

export const GET: RequestHandler = ({ url }) => exportZip(url.searchParams.getAll('id'));

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	if (!form) error(400, 'Send the demo ids as form fields named id');
	const ids = form.getAll('id').filter((id): id is string => typeof id === 'string');
	if (!ids.length) error(400, 'Pick at least one demo');
	return exportZip(ids);
};
