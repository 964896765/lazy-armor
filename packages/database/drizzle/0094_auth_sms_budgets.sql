CREATE TABLE auth_sms_quotas (
  id binary(16) NOT NULL PRIMARY KEY,
  quota_namespace varchar(160) NOT NULL,
  bucket varchar(16) NOT NULL,
  kind varchar(16) NOT NULL,
  subject_key char(64) NOT NULL,
  send_count int NOT NULL DEFAULT 0,
  reserved_fen int NOT NULL DEFAULT 0,
  last_reserved_at datetime(6) NULL,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  UNIQUE KEY auth_sms_quotas_scope_uq (quota_namespace,bucket,kind,subject_key),
  CONSTRAINT auth_sms_quotas_nonnegative_ck CHECK (send_count >= 0 AND reserved_fen >= 0)
);
--> statement-breakpoint
CREATE TABLE auth_sms_attempts (
  id binary(16) NOT NULL PRIMARY KEY,
  quota_namespace varchar(160) NOT NULL,
  bucket varchar(16) NOT NULL,
  phone_key char(64) NOT NULL,
  ip_key char(64) NOT NULL,
  purpose varchar(32) NOT NULL,
  state varchar(24) NOT NULL,
  reserved_fen int NOT NULL,
  accepted_cost_fen int NULL,
  provider_key char(64) NULL,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  INDEX auth_sms_attempts_namespace_idx (quota_namespace,created_at),
  CONSTRAINT auth_sms_attempts_cost_ck CHECK (reserved_fen > 0 AND (accepted_cost_fen IS NULL OR (accepted_cost_fen >= 0 AND accepted_cost_fen <= reserved_fen)))
);
