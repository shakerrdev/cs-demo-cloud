import { eq } from 'drizzle-orm';
import type { Db } from './client.ts';
import { settings } from './schema.ts';

const APP_CONFIG = 'app.config';

export function getSetting(db: Db, key: string): string | null {
	return (
		db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value ??
		null
	);
}

export function setSetting(db: Db, key: string, value: string | null): void {
	if (value === null) {
		db.delete(settings).where(eq(settings.key, key)).run();
		return;
	}
	db.insert(settings)
		.values({ key, value, updatedAt: new Date() })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
		.run();
}

export function getAppConfigJson(db: Db): unknown {
	const value = getSetting(db, APP_CONFIG);
	if (!value) return null;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

export function setAppConfigJson(db: Db, config: unknown | null): void {
	setSetting(db, APP_CONFIG, config === null ? null : JSON.stringify(config));
}
