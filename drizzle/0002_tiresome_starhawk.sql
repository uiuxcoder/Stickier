CREATE TABLE `membership_drops` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`month_key` text NOT NULL,
	`sticker_ids` text NOT NULL,
	`shipping_address` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitted_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_drops_user_month_idx` ON `membership_drops` (`user_id`,`month_key`);--> statement-breakpoint
CREATE INDEX `membership_drops_status_idx` ON `membership_drops` (`status`);