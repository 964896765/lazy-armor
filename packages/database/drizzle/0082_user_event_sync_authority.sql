CREATE TABLE `user_event_sync_requests` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `user_event_id` binary(16) NOT NULL,
  `user_event_version` int NOT NULL,
  `proposal_message_id` binary(16) NOT NULL,
  `contract_hash` char(64) NOT NULL,
  `contract_json` json NOT NULL,
  `confirmed_at` datetime(6) NOT NULL,
  `revoked_at` datetime(6) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_event_sync_proposal_uq` (`user_id`, `proposal_message_id`),
  KEY `user_event_sync_owner_event_idx` (`user_id`, `user_event_id`, `user_event_version`),
  CONSTRAINT `user_event_sync_owner_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
