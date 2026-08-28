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
CREATE TABLE IF NOT EXISTS `orders` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `stripe_session_id` text NOT NULL UNIQUE,
  `kind` text NOT NULL,
  `subject` text NOT NULL,
  `image_key` text NOT NULL,
  `amount` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
