CREATE TABLE `creation_drafts` (
  `draft_id` binary(16) NOT NULL, `user_id` binary(16) NOT NULL, `scenario_key` varchar(120) NOT NULL,
  `scenario_revision` int NOT NULL, `stage` int NOT NULL, `goal_json` json NOT NULL,
  `subject_json` json, `source_choices_json` json NOT NULL, `selected_offer_key` varchar(160),
  `version` int NOT NULL, `state` varchar(32) NOT NULL, `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL, `expires_at` datetime(6) NOT NULL,
  CONSTRAINT `creation_drafts_draft_id` PRIMARY KEY(`draft_id`),
  CONSTRAINT `creation_drafts_user_scenario_uq` UNIQUE(`user_id`,`scenario_key`),
  CONSTRAINT `creation_drafts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX `creation_drafts_user_state_idx` ON `creation_drafts` (`user_id`,`state`,`expires_at`);
