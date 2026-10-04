CREATE TABLE `artifacts` (
 `id` binary(16) NOT NULL PRIMARY KEY,
 `user_id` binary(16) NOT NULL,
 `request_id` varchar(100) NOT NULL,
 `file_name` varchar(160) NOT NULL,
 `mime_type` varchar(100) NOT NULL,
 `size_bytes` int NOT NULL,
 `source_sha256` varchar(64) NOT NULL,
 `source_base64` mediumtext NOT NULL,
 `extractor_key` varchar(80) NOT NULL,
 `extraction_status` varchar(24) NOT NULL,
 `extracted_text` mediumtext NULL,
 `extracted_sha256` varchar(64) NULL,
 `extraction_metadata` json NOT NULL,
 `created_at` datetime(6) NOT NULL,
 UNIQUE KEY `artifacts_request_uq` (`user_id`, `request_id`),
 FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
ALTER TABLE `consumer_attachments` ADD COLUMN `artifact_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `consumer_attachments` ADD CONSTRAINT `consumer_attachment_artifact_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts` (`id`) ON DELETE RESTRICT;
