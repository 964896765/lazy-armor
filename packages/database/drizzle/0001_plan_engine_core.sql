CREATE TABLE `plans` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `status` varchar(32) NOT NULL,
  `current_version_id` binary(16),
  `active_version_id` binary(16),
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `archived_at` datetime(6),
  CONSTRAINT `plans_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `plans_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  INDEX `plans_user_id_idx` (`user_id`),
  CONSTRAINT `plans_status_check` CHECK (`status` IN ('draft','ready','active','paused','degraded','blocked','archived'))
);
--> statement-breakpoint
CREATE TABLE `plan_versions` (
  `id` binary(16) NOT NULL,
  `plan_id` binary(16) NOT NULL,
  `version_number` int NOT NULL,
  `name` varchar(120) NOT NULL,
  `description` text,
  `domain` varchar(64) NOT NULL,
  `automation_level` varchar(8) NOT NULL,
  `definition_hash` char(64) NOT NULL,
  `created_by` binary(16) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  CONSTRAINT `plan_versions_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `plan_versions_plan_number_uq` UNIQUE (`plan_id`, `version_number`),
  CONSTRAINT `plan_versions_plan_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `plan_versions_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `plan_versions_automation_check` CHECK (`automation_level` IN ('L0','L1','L2','L3','L4')),
  INDEX `plan_versions_created_by_idx` (`created_by`)
);
--> statement-breakpoint
ALTER TABLE `plans`
  ADD CONSTRAINT `plans_current_version_id_fk` FOREIGN KEY (`current_version_id`) REFERENCES `plan_versions` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `plans_active_version_id_fk` FOREIGN KEY (`active_version_id`) REFERENCES `plan_versions` (`id`) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE `plan_sources` (
  `id` binary(16) NOT NULL,
  `plan_version_id` binary(16) NOT NULL,
  `source_type` varchar(40) NOT NULL,
  `connector_id` binary(16),
  `connection_id` binary(16),
  `config_json` json NOT NULL,
  `sort_order` int NOT NULL,
  `created_at` datetime(6) NOT NULL,
  CONSTRAINT `plan_sources_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `plan_sources_version_order_uq` UNIQUE (`plan_version_id`, `sort_order`),
  CONSTRAINT `plan_sources_version_id_fk` FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `plan_sources_connector_id_fk` FOREIGN KEY (`connector_id`) REFERENCES `connectors` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `plan_sources_connection_id_fk` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `plan_sources_type_check` CHECK (`source_type` IN ('manual','email','calendar','notification','file','webhook','internal','commerce','device','vehicle','billing','content_platform'))
);
--> statement-breakpoint
CREATE TABLE `plan_triggers` (
  `id` binary(16) NOT NULL,
  `plan_version_id` binary(16) NOT NULL,
  `trigger_type` varchar(40) NOT NULL,
  `config_json` json NOT NULL,
  `sort_order` int NOT NULL,
  `created_at` datetime(6) NOT NULL,
  CONSTRAINT `plan_triggers_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `plan_triggers_version_order_uq` UNIQUE (`plan_version_id`, `sort_order`),
  CONSTRAINT `plan_triggers_version_id_fk` FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `plan_triggers_type_check` CHECK (`trigger_type` IN ('manual','schedule','event','webhook','threshold','date_before','date_after','data_changed'))
);
--> statement-breakpoint
CREATE TABLE `plan_conditions` (
  `id` binary(16) NOT NULL,
  `plan_version_id` binary(16) NOT NULL,
  `group_id` varchar(64) NOT NULL,
  `logical_operator` varchar(8) NOT NULL,
  `field_path` varchar(128) NOT NULL,
  `operator` varchar(40) NOT NULL,
  `comparison_value_json` json,
  `sort_order` int NOT NULL,
  `created_at` datetime(6) NOT NULL,
  CONSTRAINT `plan_conditions_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `plan_conditions_version_order_uq` UNIQUE (`plan_version_id`, `sort_order`),
  CONSTRAINT `plan_conditions_version_id_fk` FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `plan_conditions_logical_check` CHECK (`logical_operator` IN ('AND','OR')),
  CONSTRAINT `plan_conditions_operator_check` CHECK (`operator` IN ('EQ','NE','GT','GTE','LT','LTE','IN','NOT_IN','CONTAINS','CHANGED','PERCENT_CHANGE_GT','TIME_RANGE','EXISTS','NOT_EXISTS'))
);
--> statement-breakpoint
CREATE TABLE `plan_actions` (
  `id` binary(16) NOT NULL,
  `plan_version_id` binary(16) NOT NULL,
  `action_type` varchar(64) NOT NULL,
  `connector_id` binary(16),
  `connection_id` binary(16),
  `required_capability` varchar(100),
  `risk_level` varchar(8) NOT NULL,
  `config_json` json NOT NULL,
  `step_order` int NOT NULL,
  `created_at` datetime(6) NOT NULL,
  CONSTRAINT `plan_actions_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `plan_actions_version_step_uq` UNIQUE (`plan_version_id`, `step_order`),
  CONSTRAINT `plan_actions_version_id_fk` FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `plan_actions_connector_id_fk` FOREIGN KEY (`connector_id`) REFERENCES `connectors` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `plan_actions_connection_id_fk` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `plan_actions_type_check` CHECK (`action_type` IN ('record','classify','summarize','compare','notify','create_draft','create_task','archive','sync','generate_content','prepare_publish','publish','prepare_purchase','create_order','update_internal_record','request_approval')),
  CONSTRAINT `plan_actions_risk_check` CHECK (`risk_level` IN ('R0','R1','R2','R3','R4'))
);
--> statement-breakpoint
CREATE TRIGGER `plan_versions_no_update` BEFORE UPDATE ON `plan_versions` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PlanVersion is immutable';
--> statement-breakpoint
CREATE TRIGGER `plan_versions_no_delete` BEFORE DELETE ON `plan_versions` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PlanVersion cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `plan_sources_no_update` BEFORE UPDATE ON `plan_sources` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PlanVersion source is immutable';
--> statement-breakpoint
CREATE TRIGGER `plan_sources_no_delete` BEFORE DELETE ON `plan_sources` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PlanVersion source cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `plan_triggers_no_update` BEFORE UPDATE ON `plan_triggers` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PlanVersion trigger is immutable';
--> statement-breakpoint
CREATE TRIGGER `plan_triggers_no_delete` BEFORE DELETE ON `plan_triggers` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PlanVersion trigger cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `plan_conditions_no_update` BEFORE UPDATE ON `plan_conditions` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PlanVersion condition is immutable';
--> statement-breakpoint
CREATE TRIGGER `plan_conditions_no_delete` BEFORE DELETE ON `plan_conditions` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PlanVersion condition cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `plan_actions_no_update` BEFORE UPDATE ON `plan_actions` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PlanVersion action is immutable';
--> statement-breakpoint
CREATE TRIGGER `plan_actions_no_delete` BEFORE DELETE ON `plan_actions` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PlanVersion action cannot be deleted';
