ALTER TABLE `creation_drafts` ADD COLUMN `scope_key` varchar(160) NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `creation_drafts` SET `scope_key` = CONCAT('scenario:', `scenario_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `creation_drafts_user_scope_uq` ON `creation_drafts` (`user_id`, `scope_key`);
--> statement-breakpoint
DROP INDEX `creation_drafts_user_scenario_uq` ON `creation_drafts`;
--> statement-breakpoint
ALTER TABLE `creation_drafts` ADD COLUMN `conversation_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `creation_drafts` ADD COLUMN `proposal_message_id` binary(16) NULL;
--> statement-breakpoint
ALTER TABLE `creation_drafts` ADD CONSTRAINT `creation_drafts_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `consumer_conversations` (`id`) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `creation_drafts` ADD CONSTRAINT `creation_drafts_proposal_fk` FOREIGN KEY (`proposal_message_id`) REFERENCES `consumer_messages` (`id`) ON DELETE RESTRICT;
