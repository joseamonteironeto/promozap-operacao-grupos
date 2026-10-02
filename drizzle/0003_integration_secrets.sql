CREATE TABLE `integration_secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`encrypted_value` text NOT NULL,
	`iv` text NOT NULL,
	`updated_at` text NOT NULL
);
