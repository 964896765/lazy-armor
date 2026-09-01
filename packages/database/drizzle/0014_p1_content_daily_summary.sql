CREATE TABLE `master_contents` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `title` varchar(160) NOT NULL,
  `body` text NULL,
  `media_references_json` json NOT NULL,
  `cover_reference` varchar(1024) NULL,
  `tags_json` json NOT NULL,
  `source_type` varchar(32) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `master_contents_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `master_contents_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  INDEX `master_contents_user_created_idx` (`user_id`, `created_at`),
  INDEX `master_contents_user_source_idx` (`user_id`, `source_type`)
);
--> statement-breakpoint

CREATE TABLE `platform_variants` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `master_content_id` binary(16) NOT NULL,
  `platform` varchar(40) NOT NULL,
  `title` varchar(160) NOT NULL,
  `description` text NULL,
  `tags_json` json NOT NULL,
  `cover_requirements` varchar(120) NOT NULL,
  `publish_status` varchar(32) NOT NULL,
  `validation_result_json` json NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `platform_variants_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `platform_variants_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `platform_variants_master_content_id_fk` FOREIGN KEY (`master_content_id`) REFERENCES `master_contents` (`id`) ON DELETE RESTRICT,
  INDEX `platform_variants_master_platform_idx` (`master_content_id`, `platform`, `created_at`),
  INDEX `platform_variants_user_status_idx` (`user_id`, `publish_status`, `created_at`)
);
--> statement-breakpoint

CREATE TABLE `important_item_candidates` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `source_type` varchar(40) NOT NULL,
  `source_id` varchar(255) NOT NULL,
  `title` varchar(160) NOT NULL,
  `summary` varchar(1000) NOT NULL,
  `occurred_at` datetime(6) NOT NULL,
  `due_at` datetime(6) NULL,
  `sender_or_organizer` varchar(255) NULL,
  `category` varchar(120) NOT NULL,
  `importance_signals_json` json NOT NULL,
  `requires_action` int NOT NULL DEFAULT 0,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `important_item_candidates_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `important_item_candidates_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `important_item_candidates_user_source_uq` UNIQUE (`user_id`, `source_type`, `source_id`),
  INDEX `important_item_candidates_due_idx` (`user_id`, `due_at`, `created_at`),
  INDEX `important_item_candidates_source_idx` (`user_id`, `source_type`, `created_at`)
);
