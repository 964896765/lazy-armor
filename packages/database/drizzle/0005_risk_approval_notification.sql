ALTER TABLE `executions`
  ADD COLUMN `risk_policy_version` varchar(32) NULL AFTER `resolved_fallback_policy_json`,
  ADD COLUMN `resolved_risk_snapshot_json` json NULL AFTER `risk_policy_version`,
  ADD COLUMN `resolved_approval_policy_json` json NULL AFTER `resolved_risk_snapshot_json`;
--> statement-breakpoint
ALTER TABLE `execution_steps`
  ADD COLUMN `effective_risk_level` varchar(8) NULL AFTER `declared_risk_level`,
  ADD COLUMN `risk_snapshot_json` json NULL AFTER `effective_risk_level`,
  ADD COLUMN `input_fingerprint` char(64) NULL AFTER `risk_snapshot_json`,
  ADD COLUMN `approval_gate_status` varchar(32) NULL AFTER `input_fingerprint`;
--> statement-breakpoint
CREATE TABLE `approval_policies` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `plan_version_id` binary(16) NOT NULL,
  `policy_type` varchar(40) NOT NULL,
  `config_json` json NOT NULL,
  `status` varchar(32) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `approval_policies_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `approval_policies_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `approval_policies_plan_version_id_fk` FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `approval_policies_user_version_uq` UNIQUE (`user_id`, `plan_version_id`),
  CONSTRAINT `approval_policies_type_check` CHECK (`policy_type` IN ('never','always','first_time','above_risk_level','above_amount','per_execution','temporary_authorization')),
  CONSTRAINT `approval_policies_status_check` CHECK (`status` IN ('active','replaced'))
);
--> statement-breakpoint
CREATE TABLE `approval_requests` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `execution_id` binary(16) NOT NULL,
  `execution_step_id` binary(16) NOT NULL,
  `plan_id` binary(16) NOT NULL,
  `plan_version_id` binary(16) NOT NULL,
  `plan_action_id` binary(16) NOT NULL,
  `input_fingerprint` char(64) NOT NULL,
  `context_hash` char(64) NOT NULL,
  `effective_risk_level` varchar(8) NOT NULL,
  `amount_minor` int NULL,
  `currency` char(3) NULL,
  `action_summary` varchar(500) NOT NULL,
  `status` varchar(32) NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `decided_at` datetime(6) NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `approval_requests_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `approval_requests_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `approval_requests_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `executions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `approval_requests_execution_step_id_fk` FOREIGN KEY (`execution_step_id`) REFERENCES `execution_steps` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `approval_requests_plan_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `approval_requests_plan_version_id_fk` FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `approval_requests_plan_action_id_fk` FOREIGN KEY (`plan_action_id`) REFERENCES `plan_actions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `approval_requests_execution_step_uq` UNIQUE (`execution_id`, `execution_step_id`),
  CONSTRAINT `approval_requests_status_check` CHECK (`status` IN ('pending','approved','rejected','expired','cancelled')),
  CONSTRAINT `approval_requests_risk_check` CHECK (`effective_risk_level` IN ('R0','R1','R2','R3','R4')),
  INDEX `approval_requests_user_status_idx` (`user_id`, `status`, `expires_at`)
);
--> statement-breakpoint
CREATE TABLE `approval_decisions` (
  `id` binary(16) NOT NULL,
  `approval_request_id` binary(16) NOT NULL,
  `actor_user_id` binary(16) NOT NULL,
  `decision` varchar(32) NOT NULL,
  `reason` varchar(500) NULL,
  `device_context_json` json NOT NULL,
  `created_at` datetime(6) NOT NULL,
  CONSTRAINT `approval_decisions_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `approval_decisions_request_id_fk` FOREIGN KEY (`approval_request_id`) REFERENCES `approval_requests` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `approval_decisions_actor_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `approval_decisions_request_uq` UNIQUE (`approval_request_id`),
  CONSTRAINT `approval_decisions_value_check` CHECK (`decision` IN ('approved','rejected','expired','cancelled'))
);
--> statement-breakpoint
CREATE TABLE `temporary_authorizations` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `plan_version_id` binary(16) NOT NULL,
  `connection_id` binary(16) NULL,
  `capability_key` varchar(100) NULL,
  `maximum_risk_level` varchar(8) NOT NULL,
  `amount_limit_minor` int NULL,
  `currency` char(3) NULL,
  `status` varchar(32) NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `revoked_at` datetime(6) NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `temporary_authorizations_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `temporary_authorizations_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `temporary_authorizations_plan_version_id_fk` FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `temporary_authorizations_connection_id_fk` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `temporary_authorizations_status_check` CHECK (`status` IN ('active','revoked')),
  CONSTRAINT `temporary_authorizations_risk_check` CHECK (`maximum_risk_level` IN ('R0','R1','R2','R3')),
  INDEX `temporary_authorizations_scope_idx` (`user_id`, `plan_version_id`, `status`, `expires_at`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `execution_id` binary(16) NULL,
  `approval_request_id` binary(16) NULL,
  `priority` varchar(8) NOT NULL,
  `event_type` varchar(100) NOT NULL,
  `dedupe_key` varchar(255) NOT NULL,
  `title` varchar(160) NOT NULL,
  `body` varchar(1000) NOT NULL,
  `action_required` int NOT NULL DEFAULT 0,
  `status` varchar(32) NOT NULL,
  `read_at` datetime(6) NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `notifications_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `notifications_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `notifications_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `executions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `notifications_approval_request_id_fk` FOREIGN KEY (`approval_request_id`) REFERENCES `approval_requests` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `notifications_user_dedupe_uq` UNIQUE (`user_id`, `dedupe_key`),
  CONSTRAINT `notifications_priority_check` CHECK (`priority` IN ('P0','P1','P2','P3')),
  CONSTRAINT `notifications_status_check` CHECK (`status` IN ('unread','read')),
  INDEX `notifications_user_priority_created_idx` (`user_id`, `priority`, `created_at`)
);
--> statement-breakpoint
CREATE TRIGGER `executions_risk_snapshot_immutable` BEFORE UPDATE ON `executions` FOR EACH ROW BEGIN IF NOT (OLD.`risk_policy_version` <=> NEW.`risk_policy_version`) OR NOT (OLD.`resolved_risk_snapshot_json` <=> NEW.`resolved_risk_snapshot_json`) OR NOT (OLD.`resolved_approval_policy_json` <=> NEW.`resolved_approval_policy_json`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Execution risk and approval snapshots are immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER `execution_steps_risk_snapshot_immutable` BEFORE UPDATE ON `execution_steps` FOR EACH ROW BEGIN IF NOT (OLD.`effective_risk_level` <=> NEW.`effective_risk_level`) OR NOT (OLD.`risk_snapshot_json` <=> NEW.`risk_snapshot_json`) OR NOT (OLD.`input_fingerprint` <=> NEW.`input_fingerprint`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ExecutionStep risk snapshot is immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER `approval_requests_no_delete` BEFORE DELETE ON `approval_requests` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ApprovalRequest history cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `approval_requests_identity_immutable` BEFORE UPDATE ON `approval_requests` FOR EACH ROW BEGIN IF NOT (OLD.`user_id` <=> NEW.`user_id`) OR NOT (OLD.`execution_id` <=> NEW.`execution_id`) OR NOT (OLD.`execution_step_id` <=> NEW.`execution_step_id`) OR NOT (OLD.`plan_id` <=> NEW.`plan_id`) OR NOT (OLD.`plan_version_id` <=> NEW.`plan_version_id`) OR NOT (OLD.`plan_action_id` <=> NEW.`plan_action_id`) OR NOT (OLD.`input_fingerprint` <=> NEW.`input_fingerprint`) OR NOT (OLD.`context_hash` <=> NEW.`context_hash`) OR NOT (OLD.`effective_risk_level` <=> NEW.`effective_risk_level`) OR NOT (OLD.`amount_minor` <=> NEW.`amount_minor`) OR NOT (OLD.`currency` <=> NEW.`currency`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ApprovalRequest identity is immutable'; END IF; IF OLD.`status` IN ('approved','rejected','expired','cancelled') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Terminal ApprovalRequest is immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER `approval_decisions_no_update` BEFORE UPDATE ON `approval_decisions` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ApprovalDecision is append-only';
--> statement-breakpoint
CREATE TRIGGER `approval_decisions_no_delete` BEFORE DELETE ON `approval_decisions` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ApprovalDecision is append-only';
--> statement-breakpoint
CREATE TRIGGER `temporary_authorizations_no_delete` BEFORE DELETE ON `temporary_authorizations` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Authorization history cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `temporary_authorizations_scope_immutable` BEFORE UPDATE ON `temporary_authorizations` FOR EACH ROW BEGIN IF NOT (OLD.`user_id` <=> NEW.`user_id`) OR NOT (OLD.`plan_version_id` <=> NEW.`plan_version_id`) OR NOT (OLD.`connection_id` <=> NEW.`connection_id`) OR NOT (OLD.`capability_key` <=> NEW.`capability_key`) OR NOT (OLD.`maximum_risk_level` <=> NEW.`maximum_risk_level`) OR NOT (OLD.`amount_limit_minor` <=> NEW.`amount_limit_minor`) OR NOT (OLD.`currency` <=> NEW.`currency`) OR NOT (OLD.`expires_at` <=> NEW.`expires_at`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Authorization scope is immutable'; END IF; IF OLD.`status` = 'revoked' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Revoked Authorization is immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER `notifications_no_delete` BEFORE DELETE ON `notifications` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Notification history cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `notifications_identity_immutable` BEFORE UPDATE ON `notifications` FOR EACH ROW BEGIN IF NOT (OLD.`user_id` <=> NEW.`user_id`) OR NOT (OLD.`execution_id` <=> NEW.`execution_id`) OR NOT (OLD.`approval_request_id` <=> NEW.`approval_request_id`) OR NOT (OLD.`priority` <=> NEW.`priority`) OR NOT (OLD.`event_type` <=> NEW.`event_type`) OR NOT (OLD.`dedupe_key` <=> NEW.`dedupe_key`) OR NOT (OLD.`title` <=> NEW.`title`) OR NOT (OLD.`body` <=> NEW.`body`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Notification identity is immutable'; END IF; END;
