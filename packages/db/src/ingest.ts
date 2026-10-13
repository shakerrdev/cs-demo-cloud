import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IncomingDemo, Storage } from '@cs-demo-cloud/shared';
import type { Db } from './client.ts';
import { createDemo, findDemoBySha256 } from './demos.ts';
import type { Demo, DemoSource } from './schema.ts';

export interface DemoInfo {
	fileName: string;
	fileModifiedAt: Date | null;
	source: DemoSource;
}

export async function registerDemo(
	db: Db,
	storage: Storage,
	incoming: IncomingDemo,
	info: DemoInfo
): Promise<{ demo: Demo; duplicate: boolean }> {
	const existing = findDemoBySha256(db, incoming.sha256);
	if (existing) {
		await rm(incoming.path, { force: true });
		return { demo: existing, duplicate: true };
	}

	const id = crypto.randomUUID();
	const target = storage.demoPath(id, incoming.format);
	await mkdir(dirname(target), { recursive: true });
	await rename(incoming.path, target);

	const demo = createDemo(db, {
		id,
		fileName: info.fileName,
		format: incoming.format,
		fileSize: incoming.size,
		fileModifiedAt: info.fileModifiedAt,
		sha256: incoming.sha256,
		source: info.source
	});
	return { demo, duplicate: false };
}
