CREATE TABLE trusted_devices (
  id BINARY(16) NOT NULL,
  user_id BINARY(16) NOT NULL,
  device_id VARCHAR(128) NOT NULL,
  key_id VARCHAR(128) NOT NULL,
  public_key_spki TEXT NOT NULL,
  public_key_fingerprint CHAR(64) NOT NULL,
  trust_level VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  last_proved_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY trusted_devices_user_device_uq (user_id, device_id),
  UNIQUE KEY trusted_devices_user_key_uq (user_id, key_id),
  KEY trusted_devices_user_status_idx (user_id, status),
  CONSTRAINT trusted_devices_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE trusted_device_challenges (
  id BINARY(16) NOT NULL,
  user_id BINARY(16) NOT NULL,
  device_id VARCHAR(128) NOT NULL,
  key_id VARCHAR(128) NOT NULL,
  public_key_fingerprint CHAR(64) NOT NULL,
  nonce CHAR(64) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  consumed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY trusted_device_challenges_nonce_uq (nonce),
  KEY trusted_device_challenges_user_device_idx (user_id, device_id, expires_at),
  CONSTRAINT trusted_device_challenges_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
);
--> statement-breakpoint
ALTER TABLE device_app_connections
  ADD COLUMN trusted_device_id BINARY(16) NULL AFTER device_id,
  ADD KEY device_app_connections_trusted_device_idx (trusted_device_id),
  ADD CONSTRAINT device_app_connections_trusted_device_id_fk FOREIGN KEY (trusted_device_id) REFERENCES trusted_devices (id) ON DELETE RESTRICT;
