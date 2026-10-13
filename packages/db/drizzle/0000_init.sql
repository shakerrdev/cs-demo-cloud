CREATE TABLE `demos` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demos_sha256_unique` ON `demos` (`sha256`);--> statement-breakpoint
CREATE INDEX `demos_status_created_at_idx` ON `demos` (`status`,`created_at`);