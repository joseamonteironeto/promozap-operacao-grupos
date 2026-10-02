CREATE TABLE `product_events` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`store` text DEFAULT 'unknown' NOT NULL,
	`product_code` text,
	`title` text,
	`image_url` text,
	`source_url` text NOT NULL,
	`resolved_url` text,
	`affiliate_url` text,
	`status` text DEFAULT 'found' NOT NULL,
	`source_group` text,
	`destination_group` text,
	`message_excerpt` text,
	`redirect_count` integer DEFAULT 0 NOT NULL,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`error_message` text,
	`found_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`sent_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_events_fingerprint_unique` ON `product_events` (`fingerprint`);
--> statement-breakpoint
CREATE INDEX `idx_product_events_status_last_seen` ON `product_events` (`status`,`last_seen_at`);
