ALTER TABLE `connectors`
  ADD COLUMN `description` varchar(255) NOT NULL DEFAULT '' AFTER `name`,
  ADD COLUMN `provider_type` varchar(32) NOT NULL DEFAULT 'internal' AFTER `status`,
  ADD COLUMN `production_status` varchar(32) NOT NULL DEFAULT 'DISABLED' AFTER `provider_type`,
  ADD COLUMN `authentication_type` varchar(32) NOT NULL DEFAULT 'none' AFTER `production_status`,
  ADD COLUMN `supports_refresh` int NOT NULL DEFAULT 0 AFTER `authentication_type`,
  ADD COLUMN `supports_revoke` int NOT NULL DEFAULT 0 AFTER `supports_refresh`,
  ADD COLUMN `supports_webhook` int NOT NULL DEFAULT 0 AFTER `supports_revoke`,
  ADD COLUMN `supports_health_check` int NOT NULL DEFAULT 1 AFTER `supports_webhook`,
  ADD COLUMN `sandbox_support` varchar(32) NOT NULL DEFAULT 'none' AFTER `supports_health_check`,
  ADD COLUMN `rate_limit_strategy` varchar(32) NOT NULL DEFAULT 'unknown' AFTER `sandbox_support`;
--> statement-breakpoint

ALTER TABLE `connector_capabilities`
  ADD COLUMN `required_permission` varchar(100) NOT NULL DEFAULT '' AFTER `risk_level`,
  ADD COLUMN `provider_availability` varchar(32) NOT NULL DEFAULT 'disabled' AFTER `required_permission`,
  ADD COLUMN `side_effect` int NOT NULL DEFAULT 0 AFTER `provider_availability`,
  ADD COLUMN `supports_idempotency_key` int NOT NULL DEFAULT 0 AFTER `side_effect`,
  ADD COLUMN `supports_operation_lookup` int NOT NULL DEFAULT 0 AFTER `supports_idempotency_key`,
  ADD COLUMN `retry_safety` varchar(32) NOT NULL DEFAULT 'ambiguous' AFTER `supports_operation_lookup`;
--> statement-breakpoint

ALTER TABLE `connections`
  ADD COLUMN `status_reason` varchar(255) NULL AFTER `status`,
  ADD COLUMN `last_error_code` varchar(64) NULL AFTER `status_reason`;
--> statement-breakpoint

CREATE TABLE `oauth_authorization_states` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `provider_key` varchar(80) NOT NULL,
  `connection_id` binary(16) NULL,
  `state` varchar(255) NOT NULL,
  `redirect_uri` varchar(500) NOT NULL,
  `code_verifier` varchar(255) NULL,
  `expires_at` datetime(6) NOT NULL,
  `consumed_at` datetime(6) NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `oauth_authorization_states_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `oauth_authorization_states_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `oauth_authorization_states_connection_id_fk` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `oauth_authorization_states_state_uq` UNIQUE (`state`),
  INDEX `oauth_authorization_states_user_provider_idx` (`user_id`, `provider_key`, `expires_at`)
);
