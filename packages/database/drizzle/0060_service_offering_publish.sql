ALTER TABLE `service_offerings` ADD COLUMN `service_area` varchar(300) NULL;
--> statement-breakpoint
ALTER TABLE `service_offerings` ADD COLUMN `contact` varchar(160) NULL;
--> statement-breakpoint
ALTER TABLE `service_offerings` ADD COLUMN `publish_request_id` varchar(100) NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `service_offerings_publish_request_uq` ON `service_offerings` (`provider_profile_id`, `publish_request_id`);
