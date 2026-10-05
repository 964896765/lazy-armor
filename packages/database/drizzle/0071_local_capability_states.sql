CREATE TABLE IF NOT EXISTS local_capability_states (
 id BINARY(16) PRIMARY KEY, user_id BINARY(16) NOT NULL, trusted_device_id BINARY(16) NOT NULL,
 capability VARCHAR(120) NOT NULL, manifest_version VARCHAR(80) NOT NULL,
 user_grant BOOLEAN NOT NULL, system_permission VARCHAR(32) NOT NULL, health VARCHAR(32) NOT NULL,
 checked_at DATETIME(6) NOT NULL, evidence_ref VARCHAR(100) NOT NULL, updated_at DATETIME(6) NOT NULL,
 UNIQUE KEY local_capability_device_key_uq(user_id,trusted_device_id,capability),
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(trusted_device_id) REFERENCES trusted_devices(id)
);
