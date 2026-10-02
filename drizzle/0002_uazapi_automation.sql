CREATE TABLE `processed_messages` (
	`message_id` text PRIMARY KEY NOT NULL,
	`group_jid` text,
	`status` text DEFAULT 'processing' NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `automation_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`stage` text NOT NULL,
	`message` text NOT NULL,
	`details_json` text,
	`group_jid` text,
	`product_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_automation_logs_created_at` ON `automation_logs` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_processed_messages_status` ON `processed_messages` (`status`,`updated_at`);
