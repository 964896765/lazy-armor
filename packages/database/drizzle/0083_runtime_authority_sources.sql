ALTER TABLE `executions` MODIFY COLUMN `plan_id` binary(16) NULL, MODIFY COLUMN `plan_version_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `action_intents` MODIFY COLUMN `plan_id` binary(16) NULL, MODIFY COLUMN `plan_version_id` binary(16) NULL, MODIFY COLUMN `plan_action_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `execution_steps` MODIFY COLUMN `plan_action_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `approval_requests` MODIFY COLUMN `plan_id` binary(16) NULL, MODIFY COLUMN `plan_version_id` binary(16) NULL, MODIFY COLUMN `plan_action_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `side_effect_operations` MODIFY COLUMN `plan_id` binary(16) NULL, MODIFY COLUMN `plan_version_id` binary(16) NULL, MODIFY COLUMN `plan_action_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `capability_resolution_decisions` MODIFY COLUMN `plan_version_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `capability_invocations` MODIFY COLUMN `plan_id` binary(16) NULL, MODIFY COLUMN `plan_version_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `executions` ADD COLUMN `authority_source_json` json NULL, ADD COLUMN `definition_snapshot_json` json NULL;
--> statement-breakpoint
ALTER TABLE `executions` ADD CONSTRAINT `executions_authority_shape_ck` CHECK (
  (`plan_id` IS NOT NULL AND `plan_version_id` IS NOT NULL) OR
  (`plan_id` IS NULL AND `plan_version_id` IS NULL AND `definition_snapshot_json` IS NOT NULL
    AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`authority_source_json`, '$.kind')), '') = 'USER_EVENT_SYNC')
);
--> statement-breakpoint
ALTER TABLE `action_intents` ADD CONSTRAINT `action_intents_authority_shape_ck` CHECK (
  (`plan_id` IS NOT NULL AND `plan_version_id` IS NOT NULL AND `plan_action_id` IS NOT NULL) OR
  (`plan_id` IS NULL AND `plan_version_id` IS NULL AND `plan_action_id` IS NULL
    AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`target_json`, '$.authoritySource.kind')), '') = 'USER_EVENT_SYNC')
);
--> statement-breakpoint
ALTER TABLE `capability_invocations` ADD CONSTRAINT `invocations_authority_shape_ck` CHECK (
  (`plan_id` IS NOT NULL AND `plan_version_id` IS NOT NULL) OR
  (`plan_id` IS NULL AND `plan_version_id` IS NULL
    AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`resource_scope`, '$.authoritySource.kind')), '') = 'USER_EVENT_SYNC')
);
