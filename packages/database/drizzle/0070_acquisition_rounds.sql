CREATE TABLE IF NOT EXISTS acquisition_rounds (
 id BINARY(16) PRIMARY KEY,user_id BINARY(16) NOT NULL,trusted_device_id BINARY(16),request_id CHAR(64) NOT NULL,
 source_id VARCHAR(255) NOT NULL,capability VARCHAR(120) NOT NULL,manifest_version VARCHAR(80) NOT NULL,state VARCHAR(32) NOT NULL,
 item_count INT,content_hash CHAR(64),observed_at DATETIME(6),scope_start DATETIME(6) NOT NULL,scope_end DATETIME(6) NOT NULL,
 evidence_refs_json JSON NOT NULL,reason VARCHAR(500) NOT NULL,created_at DATETIME(6) NOT NULL,
 UNIQUE KEY acquisition_rounds_user_request_uq(user_id,request_id),KEY acquisition_rounds_user_source_idx(user_id,source_id,created_at),
 FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(trusted_device_id) REFERENCES trusted_devices(id)
);
