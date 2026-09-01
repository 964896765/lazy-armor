CREATE TABLE `logistics_tracking_snapshots` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `tracking_number` varchar(120) NOT NULL,
  `carrier` varchar(60) NOT NULL,
  `status` varchar(32) NOT NULL,
  `latest_event` varchar(255) NULL,
  `latest_event_at` datetime(6) NULL,
  `last_updated_at` datetime(6) NOT NULL,
  `delivered_at` datetime(6) NULL,
  `source_type` varchar(32) NOT NULL,
  `metadata_json` json NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `logistics_tracking_snapshots_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `logistics_tracking_snapshots_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  INDEX `logistics_snapshots_user_tracking_idx` (`user_id`, `tracking_number`, `last_updated_at`),
  INDEX `logistics_snapshots_user_created_idx` (`user_id`, `created_at`)
);
--> statement-breakpoint

CREATE TABLE `household_supply_profiles` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `item_name` varchar(120) NOT NULL,
  `category` varchar(120) NOT NULL,
  `last_purchased_at` datetime(6) NOT NULL,
  `quantity` int NOT NULL,
  `estimated_usage_days` int NOT NULL,
  `estimated_run_out_at` datetime(6) NOT NULL,
  `source_type` varchar(32) NOT NULL,
  `metadata_json` json NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `household_supply_profiles_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `household_supply_profiles_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  INDEX `household_supply_user_item_idx` (`user_id`, `item_name`),
  INDEX `household_supply_user_runout_idx` (`user_id`, `estimated_run_out_at`)
);
--> statement-breakpoint

CREATE TABLE `prepared_shopping_items` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `source_plan_id` binary(16) NOT NULL,
  `item_name` varchar(120) NOT NULL,
  `quantity_suggestion` int NOT NULL,
  `reason` varchar(255) NOT NULL,
  `dedupe_key` varchar(255) NOT NULL,
  `status` varchar(32) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `prepared_shopping_items_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `prepared_shopping_items_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `prepared_shopping_items_source_plan_id_fk` FOREIGN KEY (`source_plan_id`) REFERENCES `plans` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `prepared_shopping_items_user_dedupe_uq` UNIQUE (`user_id`, `dedupe_key`),
  INDEX `prepared_shopping_items_plan_status_idx` (`source_plan_id`, `status`, `created_at`)
);
