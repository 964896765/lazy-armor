ALTER TABLE `truth_records` ADD COLUMN `source_read_fence_json` json NULL;
--> statement-breakpoint
ALTER TABLE `strategy_runtime_wakeups` ADD COLUMN `handoff_status` varchar(32) NULL;
--> statement-breakpoint
ALTER TABLE `strategy_runtime_wakeups` ADD COLUMN `handoff_execution_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `strategy_runtime_wakeups` ADD COLUMN `handoff_reason` varchar(120) NULL;
--> statement-breakpoint
CREATE INDEX `strategy_runtime_wakeups_handoff_idx` ON `strategy_runtime_wakeups` (`handoff_status`, `created_at`);
