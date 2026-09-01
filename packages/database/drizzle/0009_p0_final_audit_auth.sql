CREATE TABLE `auth_sessions` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `refresh_token_hash` char(64) NOT NULL,
  `family_id` binary(16) NOT NULL,
  `client_metadata_json` json NULL,
  `created_at` datetime(6) NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `last_used_at` datetime(6) NULL,
  `revoked_at` datetime(6) NULL,
  `revoke_reason` varchar(100) NULL,
  CONSTRAINT `auth_sessions_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `auth_sessions_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `auth_sessions_refresh_hash_uq` UNIQUE (`refresh_token_hash`),
  CONSTRAINT `auth_sessions_created_after_expires_check` CHECK (`created_at` <= `expires_at`)
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`, `revoked_at`);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `used_at` datetime(6) NULL,
  `created_at` datetime(6) NOT NULL,
  CONSTRAINT `password_reset_tokens_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `password_reset_tokens_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `password_reset_tokens_hash_uq` UNIQUE (`token_hash`)
);
--> statement-breakpoint
CREATE INDEX `password_reset_tokens_user_idx` ON `password_reset_tokens` (`user_id`, `created_at`);
--> statement-breakpoint
ALTER TABLE `users`
  ADD COLUMN `role` varchar(32) NOT NULL DEFAULT 'user' AFTER `status`,
  ADD CONSTRAINT `users_role_check` CHECK (`role` IN ('user','super_admin','operations_readonly'));
--> statement-breakpoint
ALTER TABLE `auth_identities`
  ADD COLUMN `email_verified_at` datetime(6) NULL AFTER `password_hash`;
