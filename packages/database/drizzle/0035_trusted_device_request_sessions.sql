CREATE TABLE trusted_device_request_sessions (
  id BINARY(16) NOT NULL,
  user_id BINARY(16) NOT NULL,
  trusted_device_id BINARY(16) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  KEY trusted_device_request_sessions_user_expires_idx (user_id, expires_at),
  KEY trusted_device_request_sessions_device_expires_idx (trusted_device_id, expires_at),
  CONSTRAINT trusted_device_request_sessions_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT trusted_device_request_sessions_device_id_fk FOREIGN KEY (trusted_device_id) REFERENCES trusted_devices (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE trusted_device_request_proofs (
  id BINARY(16) NOT NULL,
  trusted_device_session_id BINARY(16) NOT NULL,
  request_id CHAR(64) NOT NULL,
  request_method VARCHAR(12) NOT NULL,
  request_path VARCHAR(255) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  signed_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY trusted_device_request_proofs_session_request_uq (trusted_device_session_id, request_id),
  KEY trusted_device_request_proofs_session_created_idx (trusted_device_session_id, created_at),
  CONSTRAINT trusted_device_request_proofs_session_id_fk FOREIGN KEY (trusted_device_session_id) REFERENCES trusted_device_request_sessions (id) ON DELETE RESTRICT
);
