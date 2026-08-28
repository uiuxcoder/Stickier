CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`image_key` text,
	`error` text,
	`input_json` text NOT NULL,
	`photo_keys` text DEFAULT '[]' NOT NULL,
	`reserved_quota` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `generation_jobs_user_id_idx` ON `generation_jobs` (`user_id`);--> statement-breakpoint
CREATE TABLE `generations` (
	`image_key` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text,
	`created_at` integer NOT NULL,
	`purchased_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `generations_user_id_idx` ON `generations` (`user_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`stripe_session_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`image_key` text NOT NULL,
	`amount` integer NOT NULL,
	`email_sent_at` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_stripe_session_id_unique` ON `orders` (`stripe_session_id`);--> statement-breakpoint
CREATE INDEX `orders_email_idx` ON `orders` (`email`);--> statement-breakpoint
CREATE INDEX `orders_user_id_idx` ON `orders` (`user_id`);--> statement-breakpoint
CREATE INDEX `orders_image_key_idx` ON `orders` (`image_key`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`stripe_subscription_id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`current_period_end` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subscriptions_email_idx` ON `subscriptions` (`email`);--> statement-breakpoint
CREATE INDEX `subscriptions_user_id_idx` ON `subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`full_name` text,
	`stripe_customer_id` text,
	`regenerations_remaining` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);