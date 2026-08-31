ALTER TABLE `stripe_events` ADD `status` text DEFAULT 'processed' NOT NULL;--> statement-breakpoint
ALTER TABLE `stripe_events` ADD `updated_at` integer DEFAULT 0 NOT NULL;