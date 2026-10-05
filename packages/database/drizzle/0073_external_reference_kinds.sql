ALTER TABLE `external_service_references` ADD COLUMN `kind` varchar(24) NOT NULL DEFAULT 'SERVICE', ADD COLUMN `raw_text` text, ADD COLUMN `parser_version` varchar(80), ADD COLUMN `rule_id` varchar(80), ADD COLUMN `share_code` varchar(100), ADD COLUMN `evidence_artifact_id` binary(16);
--> statement-breakpoint
ALTER TABLE `external_service_references` ADD CONSTRAINT `external_reference_evidence_fk` FOREIGN KEY (`evidence_artifact_id`) REFERENCES `artifacts` (`id`) ON DELETE RESTRICT;
