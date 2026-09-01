ALTER TABLE `executions`
  ADD COLUMN `resolved_retry_policy_json` json NULL AFTER `execution_policy_version`,
  ADD COLUMN `resolved_fallback_policy_json` json NULL AFTER `resolved_retry_policy_json`,
  ADD COLUMN `worker_token` varchar(100) NULL AFTER `finished_at`,
  ADD COLUMN `heartbeat_at` datetime(6) NULL AFTER `worker_token`,
  ADD COLUMN `lease_expires_at` datetime(6) NULL AFTER `heartbeat_at`;
--> statement-breakpoint
UPDATE `executions` SET
  `resolved_retry_policy_json` = JSON_OBJECT('policyVersion','p0-5-v1','maxAttempts',3,'initialDelayMs',30000,'backoffStrategy','exponential','maxDelayMs',120000,'retryableErrorCodes',JSON_ARRAY('NETWORK_ERROR','TIMEOUT','RATE_LIMIT','TEMPORARY_UNAVAILABLE','CONNECTOR_TEMPORARY_ERROR')),
  `resolved_fallback_policy_json` = JSON_OBJECT('strategy','fail_execution')
WHERE `resolved_retry_policy_json` IS NULL OR `resolved_fallback_policy_json` IS NULL;
--> statement-breakpoint
ALTER TABLE `executions`
  MODIFY COLUMN `resolved_retry_policy_json` json NOT NULL,
  MODIFY COLUMN `resolved_fallback_policy_json` json NOT NULL,
  ADD INDEX `executions_lease_recovery_idx` (`status`, `lease_expires_at`);
--> statement-breakpoint
ALTER TABLE `execution_steps`
  ADD COLUMN `fallback_result_json` json NULL AFTER `error_message`;
--> statement-breakpoint
CREATE TRIGGER `executions_identity_immutable` BEFORE UPDATE ON `executions` FOR EACH ROW BEGIN IF NOT (OLD.`user_id` <=> NEW.`user_id`) OR NOT (OLD.`plan_id` <=> NEW.`plan_id`) OR NOT (OLD.`plan_version_id` <=> NEW.`plan_version_id`) OR NOT (OLD.`definition_hash` <=> NEW.`definition_hash`) OR NOT (OLD.`request_id` <=> NEW.`request_id`) OR NOT (OLD.`trigger_type` <=> NEW.`trigger_type`) OR NOT (OLD.`trigger_payload_json` <=> NEW.`trigger_payload_json`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Execution identity is immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER `execution_steps_identity_immutable` BEFORE UPDATE ON `execution_steps` FOR EACH ROW BEGIN IF NOT (OLD.`execution_id` <=> NEW.`execution_id`) OR NOT (OLD.`plan_action_id` <=> NEW.`plan_action_id`) OR NOT (OLD.`step_order` <=> NEW.`step_order`) OR NOT (OLD.`action_type` <=> NEW.`action_type`) OR NOT (OLD.`connector_id` <=> NEW.`connector_id`) OR NOT (OLD.`connection_id` <=> NEW.`connection_id`) OR NOT (OLD.`required_capability` <=> NEW.`required_capability`) OR NOT (OLD.`declared_risk_level` <=> NEW.`declared_risk_level`) OR NOT (OLD.`input_snapshot_json` <=> NEW.`input_snapshot_json`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ExecutionStep identity is immutable'; END IF; END;
