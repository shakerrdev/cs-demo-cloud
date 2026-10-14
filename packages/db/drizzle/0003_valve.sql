CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `steam_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`steam_id` text NOT NULL,
	`auth_code` text NOT NULL,
	`known_code` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_checked_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `valve_matches` (
	`match_id` text PRIMARY KEY NOT NULL,
	`share_code` text NOT NULL,
	`found_by` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`demo_url` text,
	`match_time` integer,
	`demo_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`found_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`demo_id`) REFERENCES `demos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `valve_matches_status_idx` ON `valve_matches` (`status`,`created_at`);