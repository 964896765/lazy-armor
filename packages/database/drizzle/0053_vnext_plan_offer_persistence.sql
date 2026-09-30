CREATE TABLE `plan_offer_snapshots` (
  `id` binary(16) NOT NULL, `user_id` binary(16) NOT NULL, `offer_key` varchar(64) NOT NULL,
  `scenario_key` varchar(120) NOT NULL, `scenario_revision` int NOT NULL, `contract_hash` char(64) NOT NULL,
  `offer_hash` char(64) NOT NULL, `precondition_hash` char(64) NOT NULL, `goal_json` json NOT NULL,
  `subject_json` json NOT NULL, `fact_demands_json` json NOT NULL, `source_resolution_json` json NOT NULL,
  `offer_json` json NOT NULL, `status` varchar(32) NOT NULL, `expires_at` datetime(6) NOT NULL,
  `chosen_at` datetime(6), `invalidated_at` datetime(6), `created_at` datetime(6) NOT NULL,
  CONSTRAINT `plan_offer_snapshots_id` PRIMARY KEY(`id`),
  CONSTRAINT `plan_offer_user_key_uq` UNIQUE(`user_id`,`offer_key`),
  CONSTRAINT `plan_offer_snapshots_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX `plan_offer_user_status_idx` ON `plan_offer_snapshots` (`user_id`,`status`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `plan_creation_contracts` (
  `id` binary(16) NOT NULL, `user_id` binary(16) NOT NULL, `plan_id` binary(16) NOT NULL,
  `plan_version_id` binary(16) NOT NULL, `offer_snapshot_id` binary(16) NOT NULL, `idempotency_key` varchar(120) NOT NULL,
  `scenario_key` varchar(120) NOT NULL, `scenario_revision` int NOT NULL, `contract_hash` char(64) NOT NULL,
  `confirmation_hash` char(64) NOT NULL, `goal_json` json NOT NULL, `subject_json` json NOT NULL,
  `fact_demands_json` json NOT NULL, `source_selection_json` json NOT NULL, `offer_json` json NOT NULL,
  `created_at` datetime(6) NOT NULL, CONSTRAINT `plan_creation_contracts_id` PRIMARY KEY(`id`),
  CONSTRAINT `plan_contract_offer_uq` UNIQUE(`offer_snapshot_id`),
  CONSTRAINT `plan_contract_user_idempotency_uq` UNIQUE(`user_id`,`idempotency_key`),
  CONSTRAINT `plan_contract_version_uq` UNIQUE(`plan_version_id`),
  CONSTRAINT `plan_contract_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action,
  CONSTRAINT `plan_contract_plan_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE restrict ON UPDATE no action,
  CONSTRAINT `plan_contract_version_fk` FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions`(`id`) ON DELETE restrict ON UPDATE no action,
  CONSTRAINT `plan_contract_offer_fk` FOREIGN KEY (`offer_snapshot_id`) REFERENCES `plan_offer_snapshots`(`id`) ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX `plan_contract_user_plan_idx` ON `plan_creation_contracts` (`user_id`,`plan_id`);
