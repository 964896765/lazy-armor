ALTER TABLE `oauth_authorization_states` ADD COLUMN `completion_status` varchar(32) NULL;
--> statement-breakpoint
ALTER TABLE `oauth_authorization_states` ADD COLUMN `failure_code` varchar(80) NULL;
