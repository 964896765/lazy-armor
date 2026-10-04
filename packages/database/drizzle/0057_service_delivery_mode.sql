ALTER TABLE `service_offerings` ADD COLUMN `delivery_mode` varchar(16) NOT NULL DEFAULT 'REMOTE' AFTER `service_type`;
--> statement-breakpoint
UPDATE `service_offerings` SET `delivery_mode` = 'LOCAL' WHERE `service_type` REGEXP 'local|device|errand|booking';
