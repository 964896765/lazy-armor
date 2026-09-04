ALTER TABLE device_app_connections
  ADD COLUMN connection_type VARCHAR(32) NOT NULL DEFAULT 'generic' AFTER display_name,
  ADD COLUMN integration_key VARCHAR(120) NULL AFTER connection_type,
  ADD COLUMN version_name VARCHAR(120) NULL AFTER integration_key,
  ADD COLUMN version_code BIGINT NULL AFTER version_name,
  ADD COLUMN launchable INT NOT NULL DEFAULT 1 AFTER version_code,
  ADD COLUMN discovery_fingerprint CHAR(64) NULL AFTER launchable;
