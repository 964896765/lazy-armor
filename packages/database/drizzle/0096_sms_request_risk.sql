CREATE TABLE auth_sms_risk_subjects (
 id binary(16) NOT NULL PRIMARY KEY,
 quota_namespace varchar(160) NOT NULL,
 kind varchar(16) NOT NULL,
 subject_key char(64) NOT NULL,
 window_started_at datetime(6) NOT NULL,
 request_count int NOT NULL DEFAULT 0,
 fingerprints_json json NULL,
 blocked_until datetime(6) NULL,
 created_at datetime(6) NOT NULL,
 updated_at datetime(6) NOT NULL,
 UNIQUE KEY auth_sms_risk_subjects_scope_uq (quota_namespace,kind,subject_key),
 INDEX auth_sms_risk_subjects_retention_idx (quota_namespace,updated_at),
 CONSTRAINT auth_sms_risk_subjects_count_ck CHECK (request_count >= 0)
);
--> statement-breakpoint
CREATE TABLE auth_sms_risk_events (
 id binary(16) NOT NULL PRIMARY KEY,
 quota_namespace varchar(160) NOT NULL,
 client_key char(64) NOT NULL,
 ip_key char(64) NOT NULL,
 phone_key char(64) NOT NULL,
 purpose varchar(32) NOT NULL,
 decision varchar(16) NOT NULL,
 reason varchar(32) NOT NULL,
 created_at datetime(6) NOT NULL,
 INDEX auth_sms_risk_events_retention_idx (quota_namespace,created_at),
 CONSTRAINT auth_sms_risk_events_decision_ck CHECK (decision IN ('ALLOW','BLOCK'))
);
