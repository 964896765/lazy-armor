CREATE TABLE `vehicle_profiles` (
  `id` BINARY(16) NOT NULL,
  `user_id` BINARY(16) NOT NULL,
  `brand` VARCHAR(120) NOT NULL,
  `model` VARCHAR(120) NOT NULL,
  `year` INT NOT NULL,
  `purchased_at` DATETIME(6) NULL,
  `mileage_km` INT NOT NULL DEFAULT 0,
  `mileage_updated_at` DATETIME(6) NOT NULL,
  `insurance_expires_at` DATETIME(6) NULL,
  `inspection_due_at` DATETIME(6) NULL,
  `maintenance_due_at` DATETIME(6) NULL,
  `maintenance_mileage_km` INT NULL,
  `tire_installed_at` DATETIME(6) NULL,
  `battery_installed_at` DATETIME(6) NULL,
  `source_type` VARCHAR(32) NOT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME(6) NOT NULL,
  `updated_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `vehicle_profiles_user_created_idx` (`user_id`, `created_at`),
  KEY `vehicle_profiles_user_due_idx` (`user_id`, `inspection_due_at`, `maintenance_due_at`),
  CONSTRAINT `vehicle_profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE TABLE `digital_account_profiles` (
  `id` BINARY(16) NOT NULL,
  `user_id` BINARY(16) NOT NULL,
  `service_name` VARCHAR(120) NOT NULL,
  `subscription_status` VARCHAR(32) NOT NULL,
  `expires_at` DATETIME(6) NULL,
  `connection_status` VARCHAR(32) NOT NULL,
  `security_reminder_at` DATETIME(6) NULL,
  `backup_status` VARCHAR(32) NOT NULL,
  `source_type` VARCHAR(32) NOT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME(6) NOT NULL,
  `updated_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `digital_accounts_user_expiry_idx` (`user_id`, `expires_at`, `created_at`),
  KEY `digital_accounts_user_status_idx` (`user_id`, `subscription_status`, `connection_status`),
  CONSTRAINT `digital_account_profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
