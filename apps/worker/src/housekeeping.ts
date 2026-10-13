import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function removeOldFiles(dir: string, olderThanMs: number): Promise<number> {
	const names = await readdir(dir).catch(() => [] as string[]);
	const cutoff = Date.now() - olderThanMs;
	let removed = 0;
	for (const name of names) {
		const path = join(dir, name);
		const info = await stat(path).catch(() => null);
		if (info?.isFile() && info.mtimeMs < cutoff) {
			await rm(path, { force: true });
			removed++;
		}
	}
	return removed;
}
