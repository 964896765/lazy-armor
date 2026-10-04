ALTER TABLE `file_imports` ADD COLUMN `artifact_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `file_imports` ADD CONSTRAINT `file_import_artifact_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts` (`id`) ON DELETE RESTRICT;
