CREATE TABLE device_app_connections (
  id BINARY(16) NOT NULL,
  user_id BINARY(16) NOT NULL,
  device_id VARCHAR(128) NOT NULL,
  package_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  enabled INT NOT NULL DEFAULT 1,
  modes_json JSON NOT NULL,
  trust_level VARCHAR(32) NOT NULL,
  last_seen_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY device_app_connections_user_device_package_uq (user_id, device_id, package_name),
  KEY device_app_connections_user_updated_idx (user_id, updated_at),
  CONSTRAINT device_app_connections_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
);
