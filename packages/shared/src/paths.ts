import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function findWorkspaceRoot(from: string): string | undefined {
	let dir = resolve(from);
	while (true) {
		if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export function resolveDataDir(env: Record<string, string | undefined> = process.env): string {
	if (env.DATA_DIR) return resolve(env.DATA_DIR);
	const root = findWorkspaceRoot(process.cwd());
	if (!root) throw new Error('DATA_DIR is not set and no workspace root was found');
	return join(root, 'data');
}
