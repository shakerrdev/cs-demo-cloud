import { sql } from 'drizzle-orm';
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

export const demoSources = ['upload', 'valve', 'extension'] as const;
export const demoStatuses = ['queued', 'processing', 'ready', 'failed'] as const;
export const demoFormats = ['dem', 'bz2', 'gz', 'zst'] as const;
export const platforms = ['valve', 'faceit', 'other'] as const;
export const sides = ['CT', 'T'] as const;
export const teams = ['a', 'b'] as const;
export const roles = ['admin', 'member'] as const;
export const valveMatchStatuses = ['pending', 'done', 'unavailable', 'failed'] as const;

const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date());

export const users = sqliteTable(
	'users',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text('name').notNull(),
		passwordHash: text('password_hash').notNull(),
		role: text('role', { enum: roles }).notNull(),
		createdAt: createdAt()
	},
	(table) => [uniqueIndex('users_name_lower_idx').on(sql`lower(${table.name})`)]
);

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: createdAt()
	},
	(table) => [index('sessions_user_idx').on(table.userId)]
);

export const apiTokens = sqliteTable(
	'api_tokens',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		hint: text('hint').notNull(),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(table) => [index('api_tokens_user_idx').on(table.userId)]
);

export const invites = sqliteTable('invites', {
	id: text('id').primaryKey(),
	role: text('role', { enum: roles }).notNull(),
	createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	usedAt: integer('used_at', { mode: 'timestamp_ms' }),
	usedBy: text('used_by').references(() => users.id, { onDelete: 'set null' }),
	createdAt: createdAt()
});

export const demos = sqliteTable(
	'demos',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		fileName: text('file_name').notNull(),
		format: text('format', { enum: demoFormats }).notNull().default('dem'),
		fileSize: integer('file_size').notNull(),
		fileModifiedAt: integer('file_modified_at', { mode: 'timestamp_ms' }),
		sha256: text('sha256').notNull().unique(),
		source: text('source', { enum: demoSources }).notNull(),
		status: text('status', { enum: demoStatuses }).notNull().default('queued'),
		error: text('error'),
		uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [index('demos_status_created_at_idx').on(table.status, table.createdAt)]
);

export const matches = sqliteTable('matches', {
	demoId: text('demo_id')
		.primaryKey()
		.references(() => demos.id, { onDelete: 'cascade' }),
	map: text('map').notNull(),
	serverName: text('server_name').notNull(),
	platform: text('platform', { enum: platforms }).notNull(),
	tickRate: integer('tick_rate').notNull(),
	durationSeconds: integer('duration_seconds').notNull(),
	roundCount: integer('round_count').notNull(),
	scoreA: integer('score_a').notNull(),
	scoreB: integer('score_b').notNull(),
	teamAName: text('team_a_name'),
	teamBName: text('team_b_name'),
	teamAStartSide: text('team_a_start_side', { enum: sides }).notNull(),
	replayVersion: integer('replay_version').notNull(),
	parseMs: integer('parse_ms').notNull(),
	parsedAt: integer('parsed_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const matchPlayers = sqliteTable(
	'match_players',
	{
		demoId: text('demo_id')
			.notNull()
			.references(() => demos.id, { onDelete: 'cascade' }),
		steamid: text('steamid').notNull(),
		name: text('name').notNull(),
		team: text('team', { enum: teams }).notNull(),
		kills: integer('kills').notNull(),
		deaths: integer('deaths').notNull(),
		assists: integer('assists').notNull(),
		damage: integer('damage').notNull(),
		headshotKills: integer('headshot_kills').notNull(),
		mvps: integer('mvps').notNull(),
		score: integer('score').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.demoId, table.steamid] }),
		index('match_players_steamid_idx').on(table.steamid)
	]
);

export const rounds = sqliteTable(
	'rounds',
	{
		demoId: text('demo_id')
			.notNull()
			.references(() => demos.id, { onDelete: 'cascade' }),
		number: integer('number').notNull(),
		startTick: integer('start_tick').notNull(),
		freezeEndTick: integer('freeze_end_tick'),
		endTick: integer('end_tick').notNull(),
		teamASide: text('team_a_side', { enum: sides }).notNull(),
		winnerSide: text('winner_side', { enum: sides }),
		winnerTeam: text('winner_team', { enum: teams }),
		reason: text('reason'),
		scoreA: integer('score_a').notNull(),
		scoreB: integer('score_b').notNull()
	},
	(table) => [primaryKey({ columns: [table.demoId, table.number] })]
);

export const kills = sqliteTable(
	'kills',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		demoId: text('demo_id')
			.notNull()
			.references(() => demos.id, { onDelete: 'cascade' }),
		round: integer('round').notNull(),
		tick: integer('tick').notNull(),
		attackerSteamid: text('attacker_steamid'),
		victimSteamid: text('victim_steamid').notNull(),
		assisterSteamid: text('assister_steamid'),
		weapon: text('weapon').notNull(),
		headshot: integer('headshot', { mode: 'boolean' }).notNull(),
		wallbang: integer('wallbang', { mode: 'boolean' }).notNull(),
		throughSmoke: integer('through_smoke', { mode: 'boolean' }).notNull(),
		noScope: integer('no_scope', { mode: 'boolean' }).notNull(),
		attackerBlind: integer('attacker_blind', { mode: 'boolean' }).notNull(),
		flashAssist: integer('flash_assist', { mode: 'boolean' }).notNull()
	},
	(table) => [index('kills_demo_round_idx').on(table.demoId, table.round)]
);

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const steamLinks = sqliteTable('steam_links', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	steamId: text('steam_id').notNull(),
	authCode: text('auth_code').notNull(),
	knownCode: text('known_code').notNull(),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }),
	lastError: text('last_error'),
	createdAt: createdAt()
});

export const valveMatches = sqliteTable(
	'valve_matches',
	{
		matchId: text('match_id').primaryKey(),
		shareCode: text('share_code').notNull(),
		foundBy: text('found_by').references(() => users.id, { onDelete: 'set null' }),
		status: text('status', { enum: valveMatchStatuses }).notNull().default('pending'),
		demoUrl: text('demo_url'),
		matchTime: integer('match_time', { mode: 'timestamp_ms' }),
		demoId: text('demo_id').references(() => demos.id, { onDelete: 'set null' }),
		attempts: integer('attempts').notNull().default(0),
		error: text('error'),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [index('valve_matches_status_idx').on(table.status, table.createdAt)]
);

export type Demo = typeof demos.$inferSelect;
export type NewDemo = typeof demos.$inferInsert;
export type DemoSource = (typeof demoSources)[number];
export type DemoStatus = (typeof demoStatuses)[number];
export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
export type MatchPlayer = typeof matchPlayers.$inferSelect;
export type NewMatchPlayer = typeof matchPlayers.$inferInsert;
export type Round = typeof rounds.$inferSelect;
export type NewRound = typeof rounds.$inferInsert;
export type Kill = typeof kills.$inferSelect;
export type NewKill = typeof kills.$inferInsert;
export type Platform = (typeof platforms)[number];
export type Role = (typeof roles)[number];
export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type SteamLink = typeof steamLinks.$inferSelect;
export type ValveMatch = typeof valveMatches.$inferSelect;
export type ValveMatchStatus = (typeof valveMatchStatuses)[number];
