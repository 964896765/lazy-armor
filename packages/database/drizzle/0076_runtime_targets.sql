CREATE TABLE runtime_targets (
 id BINARY(16) PRIMARY KEY, user_id BINARY(16) NOT NULL,
 target_type VARCHAR(32) NOT NULL, backing_ref VARCHAR(160) NOT NULL, account_scope VARCHAR(160),
 authority_epoch INT NOT NULL, authority_hash CHAR(64) NOT NULL,
 online_state VARCHAR(16) NOT NULL, health VARCHAR(24) NOT NULL, last_seen_at DATETIME(6),
 manifest_version VARCHAR(80) NOT NULL, manifest_hash CHAR(64) NOT NULL, metadata JSON NOT NULL,
 created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
 UNIQUE KEY runtime_targets_owner_backing_uq(user_id,target_type,backing_ref),
 FOREIGN KEY(user_id) REFERENCES users(id), CHECK(authority_epoch > 0)
);
