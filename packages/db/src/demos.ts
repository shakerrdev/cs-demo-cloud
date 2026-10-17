import { and, asc, desc, eq, inArray, lt, ne } from 'drizzle-orm';
import type { Db } from './client.ts';
import { demos, matches, type Demo, type NewDemo } from './schema.ts';

export function listDemos(db: Db) {
	return db
		.select({
			demo: demos,
			match: {
				map: matches.map,
				platform: matches.platform,
				scoreA: matches.scoreA,
				scoreB: matches.scoreB,
				durationSeconds: matches.durationSeconds
			}
		})
		.from(demos)
		.leftJoin(matches, eq(matches.demoId, demos.id))
		.orderBy(desc(demos.createdAt))
		.all();
}

export function getDemo(db: Db, id: string): Demo | undefined {
	return db.select().from(demos).where(eq(demos.id, id)).get();
}

export function findDemoBySha256(db: Db, sha256: string): Demo | undefined {
	return db.select().from(demos).where(eq(demos.sha256, sha256)).get();
}

export function createDemo(db: Db, demo: NewDemo): Demo {
	return db.insert(demos).values(demo).returning().get();
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

export function requeueDemo(db: Db, id: string): void {
	db.update(demos)
		.set({ status: 'queued', error: null, updatedAt: new Date() })
		.where(and(eq(demos.id, id), ne(demos.status, 'processing')))
		.run();
}

export function requeueAllDemos(db: Db): number {
	return db
		.update(demos)
		.set({ status: 'queued', error: null, updatedAt: new Date() })
		.where(ne(demos.status, 'processing'))
		.run().changes;
}

export function touchDemo(db: Db, id: string): void {
	db.update(demos).set({ updatedAt: new Date() }).where(eq(demos.id, id)).run();
}

export function requeueStaleDemos(db: Db, staleAfterMs: number): number {
	return db
		.update(demos)
		.set({ status: 'queued', updatedAt: new Date() })
		.where(
			and(eq(demos.status, 'processing'), lt(demos.updatedAt, new Date(Date.now() - staleAfterMs)))
		)
		.run().changes;
}

export function deleteDemo(db: Db, id: string): Demo | undefined {
	return db.delete(demos).where(eq(demos.id, id)).returning().get();
}
