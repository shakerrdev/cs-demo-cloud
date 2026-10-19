import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { demoStream, type DemoFormat } from '@cs-demo-cloud/shared';

export interface DemoFile {
	path: string;
	cleanup: () => Promise<void>;
}

export async function openDemoFile(
	source: string,
	format: DemoFormat,
	workDir: string
): Promise<DemoFile> {
	if (format === 'dem') return { path: source, cleanup: async () => {} };

	await mkdir(workDir, { recursive: true });
	const target = join(workDir, `${randomUUID()}.dem`);
	const cleanup = () => rm(target, { force: true });
	try {
		await pipeline(demoStream(source, format), createWriteStream(target));
	} catch (error) {
		await cleanup();
		throw error;
	}
	return { path: target, cleanup };
}
