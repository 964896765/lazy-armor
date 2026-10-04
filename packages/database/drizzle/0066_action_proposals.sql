ALTER TABLE `plans` ADD COLUMN `execution_scope` varchar(16) NOT NULL DEFAULT 'PLAN';
--> statement-breakpoint
ALTER TABLE `conversation_once_requests` ADD COLUMN `proposal_message_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `conversation_once_requests` ADD CONSTRAINT `once_proposal_message_fk` FOREIGN KEY (`proposal_message_id`) REFERENCES `consumer_messages` (`id`) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `once_proposal_message_uq` ON `conversation_once_requests` (`user_id`, `proposal_message_id`);
