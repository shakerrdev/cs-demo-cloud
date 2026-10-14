import { existsSync, statSync } from 'node:fs';

export function runAsOwnerOf(path: string): void {
	if (process.getuid?.() !== 0 || !existsSync(path)) return;
	const { uid, gid } = statSync(path);
	if (uid === 0) return;
	process.setgroups?.([]);
	process.setgid?.(gid);
	process.setuid?.(uid);
}
