CREATE TABLE `kills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`demo_id` text NOT NULL,
	`round` integer NOT NULL,
	`tick` integer NOT NULL,
	`attacker_steamid` text,
	`victim_steamid` text NOT NULL,
	`assister_steamid` text,
	`weapon` text NOT NULL,
	`headshot` integer NOT NULL,
	`wallbang` integer NOT NULL,
	`through_smoke` integer NOT NULL,
	`no_scope` integer NOT NULL,
	`attacker_blind` integer NOT NULL,
	`flash_assist` integer NOT NULL,
	FOREIGN KEY (`demo_id`) REFERENCES `demos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kills_demo_round_idx` ON `kills` (`demo_id`,`round`);--> statement-breakpoint
CREATE TABLE `match_players` (
	`demo_id` text NOT NULL,
	`steamid` text NOT NULL,
	`name` text NOT NULL,
	`team` text NOT NULL,
	`kills` integer NOT NULL,
	`deaths` integer NOT NULL,
	`assists` integer NOT NULL,
	`damage` integer NOT NULL,
	`headshot_kills` integer NOT NULL,
	`mvps` integer NOT NULL,
	`score` integer NOT NULL,
	PRIMARY KEY(`demo_id`, `steamid`),
	FOREIGN KEY (`demo_id`) REFERENCES `demos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `match_players_steamid_idx` ON `match_players` (`steamid`);--> statement-breakpoint
CREATE TABLE `matches` (
	`demo_id` text PRIMARY KEY NOT NULL,
	`map` text NOT NULL,
	`server_name` text NOT NULL,
	`platform` text NOT NULL,
	`tick_rate` integer NOT NULL,
	`duration_seconds` integer NOT NULL,
	`round_count` integer NOT NULL,
	`score_a` integer NOT NULL,
	`score_b` integer NOT NULL,
	`team_a_name` text,
	`team_b_name` text,
	`team_a_start_side` text NOT NULL,
	`replay_version` integer NOT NULL,
	`parse_ms` integer NOT NULL,
	`parsed_at` integer NOT NULL,
	FOREIGN KEY (`demo_id`) REFERENCES `demos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`demo_id` text NOT NULL,
	`number` integer NOT NULL,
	`start_tick` integer NOT NULL,
	`freeze_end_tick` integer,
	`end_tick` integer NOT NULL,
	`team_a_side` text NOT NULL,
	`winner_side` text,
	`winner_team` text,
	`reason` text,
	`score_a` integer NOT NULL,
	`score_b` integer NOT NULL,
	PRIMARY KEY(`demo_id`, `number`),
	FOREIGN KEY (`demo_id`) REFERENCES `demos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `demos` ADD `format` text DEFAULT 'dem' NOT NULL;--> statement-breakpoint
ALTER TABLE `demos` ADD `file_modified_at` integer;