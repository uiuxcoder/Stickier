ALTER TABLE `users` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `password_reset_token_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `password_reset_expires_at` integer;