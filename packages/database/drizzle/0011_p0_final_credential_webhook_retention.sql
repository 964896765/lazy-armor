ALTER TABLE `credential_refs`
  ADD COLUMN `current_version` int NOT NULL DEFAULT 1 AFTER `status`,
  ADD COLUMN `rotated_at` datetime(6) NULL AFTER `current_version`;
--> statement-breakpoint
CREATE TABLE `credential_versions` (
  `id` binary(16) NOT NULL,
  `credential_ref_id` binary(16) NOT NULL,
  `version` int NOT NULL,
  `provider_ref` varchar(255) NOT NULL,
  `status` varchar(32) NOT NULL,
  `expires_at` datetime(6) NULL,
  `revoked_at` datetime(6) NULL,
  `created_at` datetime(6) NOT NULL,
  CONSTRAINT `credential_versions_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `credential_versions_ref_id_fk` FOREIGN KEY (`credential_ref_id`) REFERENCES `credential_refs` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `credential_versions_ref_version_uq` UNIQUE (`credential_ref_id`, `version`),
  CONSTRAINT `credential_versions_status_check` CHECK (`status` IN ('active','superseded','revoked')),
  INDEX `credential_versions_ref_status_idx` (`credential_ref_id`, `status`)
);
--> statement-breakpoint
INSERT INTO `credential_versions` (`id`,`credential_ref_id`,`version`,`provider_ref`,`status`,`expires_at`,`revoked_at`,`created_at`)
SELECT UUID_TO_BIN(UUID()), `id`, 1, `credential_ref`, IF(`status` = 'revoked', 'revoked', 'active'), `expires_at`, IF(`status` = 'revoked', `updated_at`, NULL), `created_at`
FROM `credential_refs`;
--> statement-breakpoint
ALTER TABLE `webhook_receipts`
  ADD COLUMN `payload_snapshot_json` json NULL AFTER `payload`,
  ADD COLUMN `payload_size_bytes` int NULL AFTER `payload_snapshot_json`,
  ADD COLUMN `expires_at` datetime(6) NULL AFTER `received_at`,
  ADD COLUMN `purged_at` datetime(6) NULL AFTER `expires_at`,
  ADD INDEX `webhook_receipts_retention_idx` (`expires_at`, `purged_at`);
--> statement-breakpoint
UPDATE `webhook_receipts`
SET `payload_size_bytes` = OCTET_LENGTH(`payload`),
    `expires_at` = DATE_ADD(`received_at`, INTERVAL 7 DAY)
WHERE `expires_at` IS NULL;
--> statement-breakpoint
CREATE TRIGGER `credential_versions_no_delete` BEFORE DELETE ON `credential_versions` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Credential version history cannot be deleted';
--> statement-breakpoint
CREATE TRIGGER `credential_versions_identity_immutable` BEFORE UPDATE ON `credential_versions` FOR EACH ROW BEGIN IF NOT (OLD.`credential_ref_id` <=> NEW.`credential_ref_id`) OR NOT (OLD.`version` <=> NEW.`version`) OR NOT (OLD.`provider_ref` <=> NEW.`provider_ref`) OR NOT (OLD.`created_at` <=> NEW.`created_at`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Credential version identity is immutable'; END IF; IF OLD.`status` = 'revoked' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Revoked Credential version is immutable'; END IF; END;
