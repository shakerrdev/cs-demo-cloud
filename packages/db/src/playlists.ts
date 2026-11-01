import { asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { bookmarks, demos, matches, playlists, users } from './schema.ts';

export function listPlaylists(db: Db) {
	return db
		.select({
			id: playlists.id,
			name: playlists.name,
			createdAt: playlists.createdAt,
			createdBy: users.name,
			count: sql<number>`(select count(*) from ${bookmarks} where ${bookmarks.playlistId} = ${playlists.id})`
		})
		.from(playlists)
		.leftJoin(users, eq(users.id, playlists.createdBy))
		.orderBy(desc(playlists.createdAt))
		.all();
}

export function createPlaylist(db: Db, name: string, createdBy: string | null) {
	return db
		.insert(playlists)
		.values({ name: cleanName(name), createdBy })
		.returning()
		.get();
}

export function renamePlaylist(db: Db, id: string, name: string): void {
	db.update(playlists)
		.set({ name: cleanName(name) })
		.where(eq(playlists.id, id))
		.run();
}

export function deletePlaylist(db: Db, id: string): void {
	db.delete(playlists).where(eq(playlists.id, id)).run();
}

export function getPlaylist(db: Db, id: string) {
	const playlist = db.select().from(playlists).where(eq(playlists.id, id)).get();
	if (!playlist) return undefined;
	const items = db
		.select({
			id: bookmarks.id,
			demoId: bookmarks.demoId,
			round: bookmarks.round,
			tick: bookmarks.tick,
			note: bookmarks.note,
			createdAt: bookmarks.createdAt,
			createdBy: users.name,
			map: matches.map,
			fileName: demos.fileName,
			scoreA: matches.scoreA,
			scoreB: matches.scoreB
		})
		.from(bookmarks)
		.innerJoin(demos, eq(demos.id, bookmarks.demoId))
		.leftJoin(matches, eq(matches.demoId, bookmarks.demoId))
		.leftJoin(users, eq(users.id, bookmarks.createdBy))
		.where(eq(bookmarks.playlistId, id))
		.orderBy(asc(bookmarks.createdAt), asc(bookmarks.id))
		.all();
	return { ...playlist, items };
}

export function addBookmark(
	db: Db,
	bookmark: {
		playlistId: string;
		demoId: string;
		round: number;
		tick: number;
		note: string;
		createdBy: string | null;
	}
) {
	return db
		.insert(bookmarks)
		.values({ ...bookmark, note: bookmark.note.trim().slice(0, 500) })
		.returning()
		.get();
}

export function updateBookmarkNote(db: Db, id: string, note: string): void {
	db.update(bookmarks)
		.set({ note: note.trim().slice(0, 500) })
		.where(eq(bookmarks.id, id))
		.run();
}

export function deleteBookmark(db: Db, id: string): void {
	db.delete(bookmarks).where(eq(bookmarks.id, id)).run();
}

export function listDemoBookmarks(db: Db, demoId: string) {
	return db
		.select({
			id: bookmarks.id,
			playlistId: bookmarks.playlistId,
			playlist: playlists.name,
			round: bookmarks.round,
			tick: bookmarks.tick,
			note: bookmarks.note
		})
		.from(bookmarks)
		.innerJoin(playlists, eq(playlists.id, bookmarks.playlistId))
		.where(eq(bookmarks.demoId, demoId))
		.orderBy(asc(bookmarks.round), asc(bookmarks.tick))
		.all();
}

function cleanName(name: string): string {
	const clean = name.trim().slice(0, 80);
	if (!clean) throw new Error('A playlist needs a name');
	return clean;
}
