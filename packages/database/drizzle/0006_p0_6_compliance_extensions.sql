ALTER TABLE `plan_versions`
  ADD COLUMN `approval_policy_json` json NULL AFTER `automation_level`;
--> statement-breakpoint
ALTER TABLE `approval_requests`
  ADD COLUMN `action_type` varchar(64) NULL AFTER `plan_action_id`,
  ADD COLUMN `policy_snapshot` json NULL AFTER `action_type`,
  ADD COLUMN `reason` varchar(500) NULL AFTER `policy_snapshot`,
  ADD COLUMN `requested_at` datetime(6) NULL AFTER `reason`,
  ADD COLUMN `decision` varchar(32) NULL AFTER `decided_at`,
  ADD COLUMN `decision_reason` varchar(500) NULL AFTER `decision`;
--> statement-breakpoint
ALTER TABLE `temporary_authorizations`
  ADD COLUMN `plan_id` binary(16) NULL AFTER `user_id`,
  ADD COLUMN `action_type` varchar(64) NULL AFTER `capability_key`,
  ADD COLUMN `valid_from` datetime(6) NULL AFTER `currency`,
  ADD CONSTRAINT `temporary_authorizations_plan_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `notifications`
  ADD COLUMN `execution_step_id` binary(16) NULL AFTER `execution_id`,
  ADD COLUMN `title_key` varchar(120) NULL AFTER `event_type`,
  ADD COLUMN `message_key` varchar(120) NULL AFTER `title_key`,
  ADD COLUMN `message_params` json NULL AFTER `message_key`,
  ADD COLUMN `action_type` varchar(64) NULL AFTER `message_params`,
  ADD COLUMN `archived_at` datetime(6) NULL AFTER `read_at`,
  ADD CONSTRAINT `notifications_execution_step_id_fk` FOREIGN KEY (`execution_step_id`) REFERENCES `execution_steps` (`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `notifications` DROP CHECK `notifications_status_check`;
--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_status_check` CHECK (`status` IN ('unread','read','archived'));
--> statement-breakpoint
CREATE TRIGGER `approval_requests_identity_immutable_v2` BEFORE UPDATE ON `approval_requests` FOR EACH ROW BEGIN IF NOT (OLD.`action_type` <=> NEW.`action_type`) OR NOT (OLD.`policy_snapshot` <=> NEW.`policy_snapshot`) OR NOT (OLD.`reason` <=> NEW.`reason`) OR NOT (OLD.`requested_at` <=> NEW.`requested_at`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ApprovalRequest identity is immutable'; END IF; IF (OLD.`decision` IS NOT NULL AND NOT (OLD.`decision` <=> NEW.`decision`)) OR (OLD.`decision_reason` IS NOT NULL AND NOT (OLD.`decision_reason` <=> NEW.`decision_reason`)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ApprovalRequest decision is immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER `temporary_authorizations_scope_immutable_v2` BEFORE UPDATE ON `temporary_authorizations` FOR EACH ROW BEGIN IF NOT (OLD.`plan_id` <=> NEW.`plan_id`) OR NOT (OLD.`action_type` <=> NEW.`action_type`) OR NOT (OLD.`valid_from` <=> NEW.`valid_from`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Authorization scope is immutable'; END IF; END;
--> statement-breakpoint
CREATE TRIGGER `notifications_identity_immutable_v2` BEFORE UPDATE ON `notifications` FOR EACH ROW BEGIN IF NOT (OLD.`execution_step_id` <=> NEW.`execution_step_id`) OR NOT (OLD.`title_key` <=> NEW.`title_key`) OR NOT (OLD.`message_key` <=> NEW.`message_key`) OR NOT (OLD.`message_params` <=> NEW.`message_params`) OR NOT (OLD.`action_type` <=> NEW.`action_type`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Notification identity is immutable'; END IF; END;
