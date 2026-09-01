CREATE TABLE `users` (
  `id` binary(16) NOT NULL,
  `status` varchar(32) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `users_id_pk` PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE TABLE `profiles` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `display_name` varchar(120) NOT NULL,
  `avatar` varchar(1024),
  `timezone` varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
  `locale` varchar(32) NOT NULL DEFAULT 'zh-CN',
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `profiles_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `profiles_user_id_uq` UNIQUE (`user_id`),
  CONSTRAINT `profiles_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `auth_identities` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `email` varchar(320) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `auth_identities_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `auth_identities_email_uq` UNIQUE (`email`),
  CONSTRAINT `auth_identities_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  INDEX `auth_identities_user_id_idx` (`user_id`)
);
--> statement-breakpoint
CREATE TABLE `connectors` (
  `id` binary(16) NOT NULL,
  `connector_key` varchar(80) NOT NULL,
  `name` varchar(120) NOT NULL,
  `status` varchar(32) NOT NULL,
  `adapter_version` varchar(32) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `connectors_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `connectors_key_uq` UNIQUE (`connector_key`)
);
--> statement-breakpoint
CREATE TABLE `connector_capabilities` (
  `id` binary(16) NOT NULL,
  `connector_id` binary(16) NOT NULL,
  `capability_key` varchar(100) NOT NULL,
  `name` varchar(120) NOT NULL,
  `operation` varchar(32) NOT NULL,
  `risk_level` varchar(8) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  CONSTRAINT `connector_capabilities_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `connector_capabilities_connector_key_uq` UNIQUE (`connector_id`, `capability_key`),
  CONSTRAINT `connector_capabilities_connector_id_fk` FOREIGN KEY (`connector_id`) REFERENCES `connectors` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `credential_refs` (
  `id` binary(16) NOT NULL,
  `credential_ref` varchar(255) NOT NULL,
  `provider` varchar(64) NOT NULL,
  `status` varchar(32) NOT NULL,
  `expires_at` datetime(6),
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `credential_refs_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `credential_refs_ref_uq` UNIQUE (`credential_ref`)
);
--> statement-breakpoint
CREATE TABLE `connections` (
  `id` binary(16) NOT NULL,
  `user_id` binary(16) NOT NULL,
  `connector_id` binary(16) NOT NULL,
  `external_account_name` varchar(255) NOT NULL,
  `status` varchar(32) NOT NULL,
  `credential_ref_id` binary(16),
  `expires_at` datetime(6),
  `last_checked_at` datetime(6),
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `connections_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `connections_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `connections_connector_id_fk` FOREIGN KEY (`connector_id`) REFERENCES `connectors` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `connections_credential_ref_id_fk` FOREIGN KEY (`credential_ref_id`) REFERENCES `credential_refs` (`id`) ON DELETE RESTRICT,
  INDEX `connections_user_id_idx` (`user_id`),
  INDEX `connections_connector_id_idx` (`connector_id`)
);
--> statement-breakpoint
CREATE TABLE `connection_permissions` (
  `id` binary(16) NOT NULL,
  `connection_id` binary(16) NOT NULL,
  `connector_capability_id` binary(16) NOT NULL,
  `granted` int NOT NULL DEFAULT 0,
  `granted_at` datetime(6),
  `expires_at` datetime(6),
  `revoked_at` datetime(6),
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  CONSTRAINT `connection_permissions_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `connection_permissions_connection_capability_uq` UNIQUE (`connection_id`, `connector_capability_id`),
  CONSTRAINT `connection_permissions_connection_id_fk` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `connection_permissions_capability_id_fk` FOREIGN KEY (`connector_capability_id`) REFERENCES `connector_capabilities` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `webhook_receipts` (
  `id` binary(16) NOT NULL,
  `connection_id` binary(16) NOT NULL,
  `event_id` varchar(255) NOT NULL,
  `request_id` varchar(255) NOT NULL,
  `idempotency_key` varchar(255) NOT NULL,
  `payload_hash` varchar(64) NOT NULL,
  `payload` text NOT NULL,
  `received_at` datetime(6) NOT NULL,
  CONSTRAINT `webhook_receipts_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `webhook_receipts_connection_event_uq` UNIQUE (`connection_id`, `event_id`),
  CONSTRAINT `webhook_receipts_connection_idempotency_uq` UNIQUE (`connection_id`, `idempotency_key`),
  CONSTRAINT `webhook_receipts_connection_id_fk` FOREIGN KEY (`connection_id`) REFERENCES `connections` (`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO `connectors` (`id`, `connector_key`, `name`, `status`, `adapter_version`, `created_at`, `updated_at`) VALUES
  (UUID_TO_BIN('018fc000-0000-7000-8000-000000000001'), 'manual', '手动输入', 'active', '1.0.0', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
  (UUID_TO_BIN('018fc000-0000-7000-8000-000000000002'), 'internal', '内部服务', 'active', '1.0.0', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
  (UUID_TO_BIN('018fc000-0000-7000-8000-000000000003'), 'webhook', 'Webhook', 'active', '1.0.0', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6));
--> statement-breakpoint
INSERT INTO `connector_capabilities` (`id`, `connector_id`, `capability_key`, `name`, `operation`, `risk_level`, `created_at`) VALUES
  (UUID_TO_BIN('018fc000-0000-7000-8100-000000000001'), UUID_TO_BIN('018fc000-0000-7000-8000-000000000001'), 'MANUAL_INPUT', '提交手动输入', 'read', 'R0', UTC_TIMESTAMP(6)),
  (UUID_TO_BIN('018fc000-0000-7000-8100-000000000002'), UUID_TO_BIN('018fc000-0000-7000-8000-000000000002'), 'READ_INTERNAL', '读取内部数据', 'read', 'R0', UTC_TIMESTAMP(6)),
  (UUID_TO_BIN('018fc000-0000-7000-8100-000000000003'), UUID_TO_BIN('018fc000-0000-7000-8000-000000000002'), 'WRITE_INTERNAL', '写入内部数据', 'execute', 'R1', UTC_TIMESTAMP(6)),
  (UUID_TO_BIN('018fc000-0000-7000-8100-000000000004'), UUID_TO_BIN('018fc000-0000-7000-8000-000000000003'), 'RECEIVE_WEBHOOK', '接收 Webhook 事件', 'subscribe', 'R0', UTC_TIMESTAMP(6));
