CREATE TABLE `automation_button_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`labels_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL
);
