import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const demoSources = ['upload', 'valve', 'extension'] as const;
export const demoStatuses = ['queued', 'processing', 'ready', 'failed'] as const;

export const demos = sqliteTable(
	'demos',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		fileName: text('file_name').notNull(),
		fileSize: integer('file_size').notNull(),
		sha256: text('sha256').notNull().unique(),
		source: text('source', { enum: demoSources }).notNull(),
		status: text('status', { enum: demoStatuses }).notNull().default('queued'),
		error: text('error'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [index('demos_status_created_at_idx').on(table.status, table.createdAt)]
);

export type Demo = typeof demos.$inferSelect;
export type NewDemo = typeof demos.$inferInsert;
export type DemoSource = (typeof demoSources)[number];
export type DemoStatus = (typeof demoStatuses)[number];
