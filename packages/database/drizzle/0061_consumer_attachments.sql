CREATE TABLE `consumer_attachments` (
 `id` binary(16) NOT NULL,
 `conversation_id` binary(16) NOT NULL,
 `request_id` varchar(100) NOT NULL,
 `file_name` varchar(160) NOT NULL,
 `mime_type` varchar(80) NOT NULL,
 `size_bytes` int NOT NULL,
 `content_sha256` varchar(64) NOT NULL,
 `content` text NOT NULL,
 `created_at` datetime(6) NOT NULL,
 PRIMARY KEY (`id`),
 CONSTRAINT `consumer_attachments_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `consumer_conversations` (`id`) ON DELETE RESTRICT,
 UNIQUE KEY `consumer_attachments_request_uq` (`conversation_id`, `request_id`)
);
