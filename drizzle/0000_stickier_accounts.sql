CREATE TABLE IF NOT EXISTS `users` (
  `email` text PRIMARY KEY NOT NULL,
  `stripe_customer_id` text,
  `regenerations_remaining` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `subscriptions` (
  `stripe_subscription_id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `status` text NOT NULL,
  `current_period_end` integer,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `subscriptions_email_idx` ON `subscriptions` (`email`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `orders` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `stripe_session_id` text NOT NULL UNIQUE,
  `kind` text NOT NULL,
  `subject` text NOT NULL,
  `image_key` text NOT NULL,
  `amount` integer NOT NULL,
  `email_sent_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `orders_email_idx` ON `orders` (`email`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `orders_image_key_idx` ON `orders` (`image_key`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `generations` (
  `image_key` text PRIMARY KEY NOT NULL,
  `email` text,
  `created_at` integer NOT NULL,
  `purchased_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `stripe_events` (
  `id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rate_limits` (
  `key` text PRIMARY KEY NOT NULL,
  `count` integer DEFAULT 0 NOT NULL,
  `reset_at` integer NOT NULL
);
