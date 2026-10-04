CREATE TABLE `service_media` (
 `id` binary(16) NOT NULL,
 `user_id` binary(16) NOT NULL,
 `request_id` varchar(100) NOT NULL,
 `content_sha256` varchar(64) NOT NULL,
 `source_sha256` varchar(64) NOT NULL,
 `size_bytes` int NOT NULL,
 `payload` json NOT NULL,
 `created_at` datetime(6) NOT NULL,
 PRIMARY KEY (`id`),
 CONSTRAINT `service_media_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
 UNIQUE KEY `service_media_request_uq` (`user_id`, `request_id`)
);
--> statement-breakpoint
ALTER TABLE `service_offerings` ADD COLUMN `image_media_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `service_offerings` ADD CONSTRAINT `service_offerings_image_media_fk` FOREIGN KEY (`image_media_id`) REFERENCES `service_media` (`id`) ON DELETE RESTRICT;
