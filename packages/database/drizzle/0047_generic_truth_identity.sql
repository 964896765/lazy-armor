ALTER TABLE `truth_records` ADD COLUMN `fact_identity_hash` char(64) NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `truth_records_fact_identity_uq` ON `truth_records` (`fact_identity_hash`);
