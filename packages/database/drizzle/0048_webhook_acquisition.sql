ALTER TABLE `webhook_receipts`
  ADD COLUMN `acquisition_provider_key` varchar(64) NULL,
  ADD COLUMN `acquisition_status` varchar(32) NULL,
  ADD COLUMN `acquisition_attempt_count` int NULL,
  ADD COLUMN `acquisition_next_attempt_at` datetime(6) NULL,
  ADD COLUMN `acquisition_lease_token` binary(16) NULL,
  ADD COLUMN `acquisition_lease_until` datetime(6) NULL,
  ADD COLUMN `acquisition_result_json` json NULL;
--> statement-breakpoint
CREATE INDEX `webhook_receipts_acquisition_claim_idx` ON `webhook_receipts` (`acquisition_provider_key`,`acquisition_status`,`acquisition_next_attempt_at`,`acquisition_lease_until`);
