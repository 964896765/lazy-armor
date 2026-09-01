CREATE TABLE `device_profiles` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `type` varchar(80) NOT NULL,
  `brand` varchar(120) NOT NULL,
  `model` varchar(120) NOT NULL,
  `purchased_at` datetime(6) NOT NULL,
  `warranty_until` datetime(6) NULL,
  `maintenance_interval_days` int NULL,
  `source_type` varchar(32) NOT NULL,
  `metadata_json` json NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `device_profiles_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `device_profiles_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  INDEX `device_profiles_user_created_idx` (`user_id`, `created_at`),
  INDEX `device_profiles_user_type_idx` (`user_id`, `type`)
);
--> statement-breakpoint
CREATE TABLE `device_consumables` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `device_profile_id` binary(16) NOT NULL,
  `name` varchar(120) NOT NULL,
  `last_replaced_at` datetime(6) NOT NULL,
  `replacement_interval_days` int NOT NULL,
  `remind_before_days` int NOT NULL,
  `expected_replace_at` datetime(6) NOT NULL,
  `status` varchar(32) NOT NULL,
  `metadata_json` json NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `device_consumables_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `device_consumables_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `device_consumables_device_profile_id_fk` FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles` (`id`) ON DELETE RESTRICT,
  INDEX `device_consumables_profile_replace_idx` (`device_profile_id`, `expected_replace_at`, `created_at`),
  INDEX `device_consumables_user_status_idx` (`user_id`, `status`, `updated_at`)
);
