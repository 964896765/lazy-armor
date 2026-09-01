ALTER TABLE `executions` DROP CHECK `executions_status_check`;
--> statement-breakpoint
ALTER TABLE `executions` ADD CONSTRAINT `executions_status_check` CHECK (`status` IN ('created','queued','running','retry_wait','waiting_approval','waiting_dispatch','succeeded','partially_succeeded','failed','cancelled'));
--> statement-breakpoint
ALTER TABLE `execution_steps` DROP CHECK `execution_steps_status_check`;
--> statement-breakpoint
ALTER TABLE `execution_steps` ADD CONSTRAINT `execution_steps_status_check` CHECK (`status` IN ('pending','running','waiting_dispatch','retry_wait','succeeded','failed','skipped','cancelled'));
--> statement-breakpoint
ALTER TABLE `execution_steps`
  ADD COLUMN `dispatch_status` varchar(32) NULL AFTER `approval_gate_status`,
  ADD CONSTRAINT `execution_steps_dispatch_status_check` CHECK (`dispatch_status` IN ('prepared','queued','executing','succeeded','failed','outcome_unknown','cancelled'));
--> statement-breakpoint
CREATE TABLE `side_effect_operations` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `execution_id` binary(16) NOT NULL,
  `execution_step_id` binary(16) NOT NULL,
  `plan_id` binary(16) NOT NULL,
  `plan_version_id` binary(16) NOT NULL,
  `plan_action_id` binary(16) NOT NULL,
  `action_type` varchar(64) NOT NULL,
  `connector_id` binary(16) NULL,
  `connection_id` binary(16) NULL,
  `capability_key` varchar(100) NULL,
  `idempotency_key` char(64) NOT NULL,
  `input_fingerprint` char(64) NOT NULL,
  `request_snapshot_json` json NOT NULL,
  `status` varchar(32) NOT NULL,
  `provider_operation_id` varchar(255) NULL,
  `provider_idempotency_key` varchar(255) NULL,
  `attempt_count` int NOT NULL DEFAULT 0,
  `result_snapshot_json` json NULL,
  `result_hash` char(64) NULL,
  `error_code` varchar(100) NULL,
  `error_message` varchar(1000) NULL,
  `correlation_id` varchar(255) NOT NULL,
  `causation_id` varchar(255) NULL,
  `created_at` datetime(6) NOT NULL,
  `started_at` datetime(6) NULL,
  `finished_at` datetime(6) NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `side_effect_operations_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `side_effect_operations_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `side_effect_operations_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `executions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `side_effect_operations_execution_step_id_fk` FOREIGN KEY (`execution_step_id`) REFERENCES `execution_steps` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `side_effect_operations_plan_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `side_effect_operations_plan_version_id_fk` FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `side_effect_operations_plan_action_id_fk` FOREIGN KEY (`plan_action_id`) REFERENCES `plan_actions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `side_effect_operations_user_key_uq` UNIQUE (`user_id`, `idempotency_key`),
  CONSTRAINT `side_effect_operations_status_check` CHECK (`status` IN ('prepared','queued','executing','succeeded','failed','outcome_unknown','cancelled','retry_wait')),
  CONSTRAINT `side_effect_operations_fingerprint_check` CHECK (char_length(`input_fingerprint`) = 64),
  INDEX `side_effect_operations_execution_idx` (`execution_id`, `execution_step_id`),
  INDEX `side_effect_operations_status_idx` (`status`, `updated_at`)
);
--> statement-breakpoint
CREATE TABLE `outbox_messages` (
  `id` binary(16) NOT NULL,
  `aggregate_type` varchar(40) NOT NULL,
  `aggregate_id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `event_type` varchar(100) NOT NULL,
  `destination` varchar(80) NOT NULL,
  `payload_json` json NOT NULL,
  `payload_hash` char(64) NOT NULL,
  `dedupe_key` varchar(255) NOT NULL,
  `correlation_id` varchar(255) NOT NULL,
  `causation_id` varchar(255) NULL,
  `status` varchar(32) NOT NULL,
  `attempt_count` int NOT NULL DEFAULT 0,
  `next_attempt_at` datetime(6) NOT NULL,
  `locked_by` varchar(100) NULL,
  `lock_expires_at` datetime(6) NULL,
  `last_error_code` varchar(100) NULL,
  `last_error_message` varchar(1000) NULL,
  `created_at` datetime(6) NOT NULL,
  `published_at` datetime(6) NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `outbox_messages_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `outbox_messages_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `outbox_messages_dedupe_uq` UNIQUE (`dedupe_key`),
  CONSTRAINT `outbox_messages_status_check` CHECK (`status` IN ('pending','processing','published','retry_wait','dead','cancelled')),
  INDEX `outbox_messages_dispatch_idx` (`status`, `next_attempt_at`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
  `id` binary(16) NOT NULL,
  `actor_type` varchar(32) NOT NULL,
  `actor_user_id` binary(16) NULL,
  `action` varchar(100) NOT NULL,
  `resource_type` varchar(64) NOT NULL,
  `resource_id` varchar(64) NULL,
  `user_id` binary(16) NOT NULL,
  `execution_id` binary(16) NULL,
  `execution_step_id` binary(16) NULL,
  `approval_request_id` binary(16) NULL,
  `side_effect_operation_id` binary(16) NULL,
  `outbox_message_id` binary(16) NULL,
  `request_id` varchar(255) NULL,
  `correlation_id` varchar(255) NULL,
  `causation_id` varchar(255) NULL,
  `before_snapshot_json` json NULL,
  `after_snapshot_json` json NULL,
  `change_summary` varchar(1000) NULL,
  `source` varchar(40) NOT NULL,
  `result` varchar(32) NOT NULL,
  `reason_code` varchar(100) NULL,
  `created_at` datetime(6) NOT NULL,
  CONSTRAINT `audit_logs_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `audit_logs_actor_user_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `audit_logs_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `audit_logs_actor_type_check` CHECK (`actor_type` IN ('user','system','worker','outbox_worker','admin')),
  CONSTRAINT `audit_logs_result_check` CHECK (`result` IN ('success','failure','blocked','unknown','pending')),
  INDEX `audit_logs_user_created_idx` (`user_id`, `created_at`),
  INDEX `audit_logs_correlation_idx` (`correlation_id`),
  INDEX `audit_logs_resource_idx` (`resource_type`, `resource_id`)
);
--> statement-breakpoint
CREATE TRIGGER `audit_logs_no_update` BEFORE UPDATE ON `audit_logs` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log is append-only';
--> statement-breakpoint
CREATE TRIGGER `audit_logs_no_delete` BEFORE DELETE ON `audit_logs` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log is append-only';
--> statement-breakpoint
CREATE TRIGGER `side_effect_operations_no_delete` BEFORE DELETE ON `side_effect_operations` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SideEffectOperation history cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `side_effect_operations_key_immutable` BEFORE UPDATE ON `side_effect_operations` FOR EACH ROW BEGIN IF NOT (OLD.`user_id` <=> NEW.`user_id`) OR NOT (OLD.`execution_id` <=> NEW.`execution_id`) OR NOT (OLD.`execution_step_id` <=> NEW.`execution_step_id`) OR NOT (OLD.`idempotency_key` <=> NEW.`idempotency_key`) OR NOT (OLD.`input_fingerprint` <=> NEW.`input_fingerprint`) OR NOT (OLD.`plan_version_id` <=> NEW.`plan_version_id`) OR NOT (OLD.`plan_action_id` <=> NEW.`plan_action_id`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SideEffectOperation idempotency scope is immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER `outbox_messages_no_delete` BEFORE DELETE ON `outbox_messages` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Outbox history cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `outbox_messages_identity_immutable` BEFORE UPDATE ON `outbox_messages` FOR EACH ROW BEGIN IF NOT (OLD.`dedupe_key` <=> NEW.`dedupe_key`) OR NOT (OLD.`payload_json` <=> NEW.`payload_json`) OR NOT (OLD.`payload_hash` <=> NEW.`payload_hash`) OR NOT (OLD.`aggregate_type` <=> NEW.`aggregate_type`) OR NOT (OLD.`aggregate_id` <=> NEW.`aggregate_id`) OR NOT (OLD.`user_id` <=> NEW.`user_id`) OR NOT (OLD.`destination` <=> NEW.`destination`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Outbox identity is immutable'; END IF; END;
