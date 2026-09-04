CREATE TABLE truth_records (
  id BINARY(16) NOT NULL,
  user_id BINARY(16) NOT NULL,
  resource_key VARCHAR(120) NOT NULL,
  subject_key VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  current_version_id BINARY(16) NULL,
  source_receipt_id BINARY(16) NOT NULL,
  verified_by VARCHAR(32) NOT NULL,
  verified_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY truth_records_user_receipt_uq (user_id, source_receipt_id),
  KEY truth_records_user_resource_status_idx (user_id, resource_key, status, verified_at),
  CONSTRAINT truth_records_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT truth_records_source_receipt_id_fk FOREIGN KEY (source_receipt_id) REFERENCES mobile_notification_receipts (id) ON DELETE RESTRICT
);

CREATE TABLE truth_record_versions (
  id BINARY(16) NOT NULL,
  truth_record_id BINARY(16) NOT NULL,
  version_number INT NOT NULL,
  value_json JSON NOT NULL,
  value_hash CHAR(64) NOT NULL,
  verification_method VARCHAR(64) NOT NULL,
  evidence_hash CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY truth_record_versions_record_version_uq (truth_record_id, version_number),
  KEY truth_record_versions_record_created_idx (truth_record_id, created_at),
  CONSTRAINT truth_record_versions_record_id_fk FOREIGN KEY (truth_record_id) REFERENCES truth_records (id) ON DELETE RESTRICT
);

ALTER TABLE truth_records
  ADD CONSTRAINT truth_records_current_version_id_fk FOREIGN KEY (current_version_id) REFERENCES truth_record_versions (id) ON DELETE RESTRICT;
