CREATE TABLE `service_provider_profiles` (
  `id` binary(16) NOT NULL, `user_id` binary(16) NOT NULL, `display_name` varchar(120) NOT NULL,
  `status` varchar(32) NOT NULL, `verified_at` datetime(6), `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `service_provider_profiles_id` PRIMARY KEY(`id`),
  CONSTRAINT `service_provider_profiles_user_uq` UNIQUE(`user_id`),
  CONSTRAINT `service_provider_profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX `service_provider_profiles_status_idx` ON `service_provider_profiles` (`status`);
--> statement-breakpoint
CREATE TABLE `service_offerings` (
  `id` binary(16) NOT NULL, `provider_profile_id` binary(16) NOT NULL, `domain` varchar(40) NOT NULL,
  `service_type` varchar(40) NOT NULL, `title` varchar(160) NOT NULL, `summary` varchar(600) NOT NULL,
  `tags_json` json NOT NULL, `price_min_minor` int, `price_max_minor` int, `currency` char(3),
  `rating_basis_points` int, `use_count` int NOT NULL DEFAULT 0, `image_url` varchar(1000),
  `status` varchar(32) NOT NULL, `created_at` datetime(6) NOT NULL, `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `service_offerings_id` PRIMARY KEY(`id`),
  CONSTRAINT `service_offerings_provider_profile_id_fk` FOREIGN KEY (`provider_profile_id`) REFERENCES `service_provider_profiles`(`id`) ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX `service_offerings_catalog_idx` ON `service_offerings` (`status`,`domain`,`service_type`,`created_at`);
--> statement-breakpoint
CREATE INDEX `service_offerings_provider_idx` ON `service_offerings` (`provider_profile_id`,`status`);
