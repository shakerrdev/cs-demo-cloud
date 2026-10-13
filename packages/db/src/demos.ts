import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from './client.ts';
import { demos, type Demo } from './schema.ts';

export function listDemos(db: Db): Demo[] {
	return db.select().from(demos).orderBy(desc(demos.createdAt)).all();
}

export function claimNextDemo(db: Db): Demo | undefined {
	const next = db
		.select({ id: demos.id })
		.from(demos)
		.where(eq(demos.status, 'queued'))
		.orderBy(asc(demos.createdAt))
		.limit(1);

	return db
		.update(demos)
		.set({ status: 'processing', updatedAt: new Date() })
		.where(inArray(demos.id, next))
		.returning()
		.get();
}

export function completeDemo(db: Db, id: string): void {
	db.update(demos)
		.set({ status: 'ready', error: null, updatedAt: new Date() })
		.where(eq(demos.id, id))
		.run();
}

export function failDemo(db: Db, id: string, error: string): void {
	db.update(demos)
		.set({ status: 'failed', error, updatedAt: new Date() })
		.where(eq(demos.id, id))
		.run();
}

export function requeueStaleDemos(db: Db): number {
	return db
		.update(demos)
		.set({ status: 'queued', updatedAt: new Date() })
		.where(eq(demos.status, 'processing'))
		.run().changes;
}
