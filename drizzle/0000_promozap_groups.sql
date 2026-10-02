CREATE TABLE `group_configs` (
	`jid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'ignored' NOT NULL,
	`category` text DEFAULT 'geral' NOT NULL,
	`destination_jid` text,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_group_configs_role_category` ON `group_configs` (`role`,`category`);
--> statement-breakpoint
CREATE TABLE `affiliate_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`amazon_tracking_id` text DEFAULT '' NOT NULL,
	`mercado_livre_label` text DEFAULT '' NOT NULL,
	`redirect_domain` text DEFAULT '' NOT NULL,
	`amazon_enabled` integer DEFAULT true NOT NULL,
	`mercado_livre_enabled` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
