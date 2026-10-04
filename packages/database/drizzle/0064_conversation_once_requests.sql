CREATE TABLE `conversation_once_requests` (
 `id` binary(16) NOT NULL,
 `user_id` binary(16) NOT NULL,
 `conversation_id` binary(16) NOT NULL,
 `plan_id` binary(16) NOT NULL,
 `plan_version_id` binary(16) NOT NULL,
 `request_id` varchar(100) NOT NULL,
 `input_hash` varchar(64) NOT NULL,
 `trigger_payload` json NOT NULL,
 `created_at` datetime(6) NOT NULL,
 PRIMARY KEY (`id`),
 UNIQUE KEY `conversation_once_request_uq` (`user_id`, `request_id`),
 FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
 FOREIGN KEY (`conversation_id`) REFERENCES `consumer_conversations` (`id`) ON DELETE RESTRICT,
 FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`) ON DELETE RESTRICT,
 FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions` (`id`) ON DELETE RESTRICT
);
