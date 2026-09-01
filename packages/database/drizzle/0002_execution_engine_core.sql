CREATE TABLE `executions` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `plan_id` binary(16) NOT NULL,
  `plan_version_id` binary(16) NOT NULL,
  `definition_hash` char(64) NOT NULL,
  `request_id` varchar(255) NOT NULL,
  `retry_of_execution_id` binary(16),
  `trigger_type` varchar(32) NOT NULL,
  `trigger_payload_json` json NOT NULL,
  `status` varchar(32) NOT NULL,
  `declared_risk_level` varchar(8) NOT NULL,
  `approval_status` varchar(32) NOT NULL,
  `execution_policy_version` varchar(32) NOT NULL,
  `result_code` varchar(100),
  `result_summary` varchar(1000),
  `error_code` varchar(100),
  `error_message` varchar(1000),
  `cancellation_requested_at` datetime(6),
  `queued_at` datetime(6),
  `started_at` datetime(6),
  `finished_at` datetime(6),
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `executions_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `executions_user_request_uq` UNIQUE (`user_id`, `request_id`),
  CONSTRAINT `executions_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `executions_plan_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `executions_plan_version_id_fk` FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `executions_retry_of_fk` FOREIGN KEY (`retry_of_execution_id`) REFERENCES `executions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `executions_status_check` CHECK (`status` IN ('created','queued','running','retry_wait','waiting_approval','succeeded','partially_succeeded','failed','cancelled')),
  CONSTRAINT `executions_risk_check` CHECK (`declared_risk_level` IN ('R0','R1','R2','R3','R4')),
  CONSTRAINT `executions_trigger_check` CHECK (`trigger_type` = 'manual'),
  INDEX `executions_user_created_idx` (`user_id`, `created_at`),
  INDEX `executions_plan_created_idx` (`plan_id`, `created_at`),
  INDEX `executions_status_updated_idx` (`status`, `updated_at`)
);
--> statement-breakpoint
CREATE TABLE `execution_steps` (
  `id` binary(16) NOT NULL,
  `execution_id` binary(16) NOT NULL,
  `plan_action_id` binary(16) NOT NULL,
  `step_order` int NOT NULL,
  `action_type` varchar(64) NOT NULL,
  `connector_id` binary(16),
  `connection_id` binary(16),
  `required_capability` varchar(100),
  `declared_risk_level` varchar(8) NOT NULL,
  `status` varchar(32) NOT NULL,
  `attempt_count` int NOT NULL DEFAULT 0,
  `retry_count` int NOT NULL DEFAULT 0,
  `input_snapshot_json` json,
  `output_snapshot_json` json,
  `next_retry_at` datetime(6),
  `started_at` datetime(6),
  `finished_at` datetime(6),
  `error_code` varchar(100),
  `error_message` varchar(1000),
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `execution_steps_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `execution_steps_execution_order_uq` UNIQUE (`execution_id`, `step_order`),
  CONSTRAINT `execution_steps_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `executions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `execution_steps_plan_action_id_fk` FOREIGN KEY (`plan_action_id`) REFERENCES `plan_actions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `execution_steps_connector_id_fk` FOREIGN KEY (`connector_id`) REFERENCES `connectors` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `execution_steps_connection_id_fk` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `execution_steps_status_check` CHECK (`status` IN ('pending','running','retry_wait','succeeded','failed','skipped','cancelled')),
  CONSTRAINT `execution_steps_risk_check` CHECK (`declared_risk_level` IN ('R0','R1','R2','R3','R4')),
  INDEX `execution_steps_status_retry_idx` (`status`, `next_retry_at`)
);
--> statement-breakpoint
CREATE TABLE `execution_events` (
  `id` binary(16) NOT NULL,
  `execution_id` binary(16) NOT NULL,
  `execution_step_id` binary(16),
  `event_type` varchar(100) NOT NULL,
  `data_json` json NOT NULL,
  `created_at` datetime(6) NOT NULL,
  CONSTRAINT `execution_events_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `execution_events_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `executions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `execution_events_step_id_fk` FOREIGN KEY (`execution_step_id`) REFERENCES `execution_steps` (`id`) ON DELETE RESTRICT,
  INDEX `execution_events_execution_created_idx` (`execution_id`, `created_at`)
);
--> statement-breakpoint
CREATE TRIGGER `executions_no_delete` BEFORE DELETE ON `executions` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Execution history cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `execution_steps_no_delete` BEFORE DELETE ON `execution_steps` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ExecutionStep history cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `execution_events_no_update` BEFORE UPDATE ON `execution_events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ExecutionEvent is append-only';
--> statement-breakpoint
CREATE TRIGGER `execution_events_no_delete` BEFORE DELETE ON `execution_events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ExecutionEvent is append-only';
--> statement-breakpoint
CREATE TRIGGER `executions_terminal_no_update` BEFORE UPDATE ON `executions` FOR EACH ROW BEGIN IF OLD.`status` IN ('succeeded','partially_succeeded','failed','cancelled') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Terminal Execution is immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER `execution_steps_terminal_no_update` BEFORE UPDATE ON `execution_steps` FOR EACH ROW BEGIN IF OLD.`status` IN ('succeeded','failed','skipped','cancelled') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Terminal ExecutionStep is immutable'; END IF; END;
