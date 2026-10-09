CREATE TABLE personal_memory_settings (
  user_id binary(16) NOT NULL PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 0,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  CONSTRAINT personal_memory_settings_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE personal_memories (
  id binary(16) NOT NULL PRIMARY KEY,
  user_id binary(16) NOT NULL,
  request_id varchar(160) NOT NULL,
  type varchar(32) NOT NULL,
  title varchar(120) NULL,
  content text NULL,
  source_kind varchar(32) NOT NULL,
  status varchar(16) NOT NULL,
  version int NOT NULL,
  confirmed_at datetime(6) NOT NULL,
  expires_at datetime(6) NULL,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  UNIQUE KEY personal_memory_request_uq (user_id, request_id),
  KEY personal_memory_owner_status_idx (user_id, status, created_at, id),
  CONSTRAINT personal_memory_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);
