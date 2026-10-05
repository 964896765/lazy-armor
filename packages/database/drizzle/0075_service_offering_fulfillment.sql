ALTER TABLE `service_offerings` ADD COLUMN `delivery_modes` json, ADD COLUMN `price_mode` varchar(24) NOT NULL DEFAULT 'NEGOTIABLE', ADD COLUMN `service_address` varchar(600), ADD COLUMN `location_instructions` varchar(600), ADD COLUMN `remote_instructions` varchar(600), ADD COLUMN `shipping_instructions` varchar(600), ADD COLUMN `shipping_fee_rules` varchar(600), ADD COLUMN `delivery_instructions` varchar(600), ADD COLUMN `booking_instructions` varchar(600);
--> statement-breakpoint
UPDATE `service_offerings` SET `delivery_mode`='ONSITE' WHERE `delivery_mode`='LOCAL';
--> statement-breakpoint
UPDATE `service_offerings` SET `delivery_modes`=JSON_ARRAY(`delivery_mode`) WHERE `delivery_mode` IN ('ONSITE','AT_LOCATION','REMOTE','LOGISTICS','OTHER');
--> statement-breakpoint
UPDATE `service_offerings` SET `remote_instructions`=`service_area`, `service_area`=NULL WHERE `delivery_mode`='REMOTE';
--> statement-breakpoint
UPDATE `service_offerings` SET `price_mode`=CASE WHEN `price_min_minor` IS NULL THEN 'NEGOTIABLE' ELSE 'STARTING_FROM' END;
