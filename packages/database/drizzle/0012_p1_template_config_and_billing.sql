ALTER TABLE `plan_versions`
  ADD COLUMN `template_key` varchar(120) NULL AFTER `approval_policy_json`,
  ADD COLUMN `template_version` varchar(32) NULL AFTER `template_key`,
  ADD COLUMN `template_config_json` json NULL AFTER `template_version`;
--> statement-breakpoint
CREATE TABLE `billing_records` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `provider` varchar(120) NOT NULL,
  `category` varchar(120) NOT NULL,
  `billing_period` varchar(20) NOT NULL,
  `amount_minor` int NOT NULL,
  `currency` char(3) NOT NULL,
  `occurred_at` datetime(6) NOT NULL,
  `source_type` varchar(32) NOT NULL,
  `metadata_json` json NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `billing_records_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `billing_records_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  INDEX `billing_records_user_period_idx` (`user_id`, `billing_period`, `occurred_at`),
  INDEX `billing_records_user_created_idx` (`user_id`, `created_at`)
);
--> statement-breakpoint
CREATE TRIGGER `billing_records_no_delete` BEFORE DELETE ON `billing_records` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BillingRecord history cannot be deleted';
