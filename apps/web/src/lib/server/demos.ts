import { rm } from 'node:fs/promises';
import { deleteDemo, getDemo, type Demo, type SessionUser } from '@cs-demo-cloud/db';
import { db } from './db.ts';
import { storage } from './storage.ts';

export type RemoveResult = 'removed' | 'missing' | 'forbidden' | 'busy';

export function canRemoveDemo(user: SessionUser | null, demo: Demo): boolean {
	return user !== null && (user.role === 'admin' || demo.uploadedBy === user.id);
}

export async function removeDemo(user: SessionUser | null, id: string): Promise<RemoveResult> {
	const demo = getDemo(db, id);
	if (!demo) return 'missing';
	if (!canRemoveDemo(user, demo)) return 'forbidden';
	if (demo.status === 'processing') return 'busy';
	deleteDemo(db, id);
	await Promise.all([
		rm(storage.demoPath(id, demo.format), { force: true }),
		rm(storage.replayDir(id), { recursive: true, force: true })
	]);
	return 'removed';
}
