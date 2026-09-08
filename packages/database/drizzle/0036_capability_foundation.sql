CREATE TABLE provider_capability_manifests (
  id BINARY(16) NOT NULL,
  provider_key VARCHAR(80) NOT NULL,
  schema_version VARCHAR(16) NOT NULL,
  revision INT NOT NULL,
  manifest_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  manifest_json JSON NOT NULL,
  superseded_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY provider_capability_manifests_provider_revision_uq (provider_key, revision),
  UNIQUE KEY provider_capability_manifests_hash_uq (manifest_hash),
  KEY provider_capability_manifests_provider_status_idx (provider_key, status)
);
--> statement-breakpoint
CREATE TABLE provider_capability_evidence (
  id BINARY(16) NOT NULL,
  manifest_id BINARY(16) NOT NULL,
  capability_key VARCHAR(100) NULL,
  evidence_kind VARCHAR(32) NOT NULL,
  review_status VARCHAR(32) NOT NULL,
  uri VARCHAR(1000) NULL,
  summary VARCHAR(1000) NOT NULL,
  verified_at DATETIME(6) NULL,
  last_checked_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  KEY provider_capability_evidence_manifest_capability_idx (manifest_id, capability_key),
  CONSTRAINT provider_capability_evidence_manifest_id_fk FOREIGN KEY (manifest_id) REFERENCES provider_capability_manifests (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE connection_capability_grants (
  id BINARY(16) NOT NULL,
  connection_id BINARY(16) NOT NULL,
  provider_key VARCHAR(80) NOT NULL,
  capability_key VARCHAR(100) NOT NULL,
  status VARCHAR(32) NOT NULL,
  granted_scopes_json JSON NOT NULL,
  granted_at DATETIME(6) NULL,
  expires_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  source VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY connection_capability_grants_connection_capability_uq (connection_id, capability_key),
  KEY connection_capability_grants_provider_status_idx (provider_key, status),
  CONSTRAINT connection_capability_grants_connection_id_fk FOREIGN KEY (connection_id) REFERENCES connections (id) ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO connection_capability_grants (
  id, connection_id, provider_key, capability_key, status, granted_scopes_json,
  granted_at, expires_at, revoked_at, source, created_at, updated_at
)
SELECT
  UUID_TO_BIN(UUID()), cp.connection_id, c.connector_key, cc.capability_key,
  CASE
    WHEN cp.revoked_at IS NOT NULL OR cp.granted = 0 THEN 'REVOKED'
    WHEN cp.expires_at IS NOT NULL AND cp.expires_at <= UTC_TIMESTAMP(6) THEN 'EXPIRED'
    ELSE 'GRANTED'
  END,
  CASE WHEN cp.granted = 1 AND cp.revoked_at IS NULL THEN JSON_ARRAY(cc.capability_key) ELSE JSON_ARRAY() END,
  cp.granted_at, cp.expires_at, cp.revoked_at, 'LEGACY_PERMISSION_MIGRATION', cp.created_at, cp.updated_at
FROM connection_permissions cp
JOIN connector_capabilities cc ON cc.id = cp.connector_capability_id
JOIN connectors c ON c.id = cc.connector_id;
--> statement-breakpoint
CREATE TABLE provider_capability_health (
  id BINARY(16) NOT NULL,
  connection_id BINARY(16) NOT NULL,
  provider_key VARCHAR(80) NOT NULL,
  capability_key VARCHAR(100) NOT NULL,
  status VARCHAR(32) NOT NULL,
  reason_code VARCHAR(100) NULL,
  detail VARCHAR(1000) NULL,
  checked_at DATETIME(6) NOT NULL,
  valid_until DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY provider_capability_health_connection_capability_uq (connection_id, capability_key),
  KEY provider_capability_health_provider_status_idx (provider_key, status, checked_at),
  CONSTRAINT provider_capability_health_connection_id_fk FOREIGN KEY (connection_id) REFERENCES connections (id) ON DELETE RESTRICT
);
