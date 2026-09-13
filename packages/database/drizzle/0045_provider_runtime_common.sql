ALTER TABLE provider_capability_evidence
  ADD COLUMN provider_key varchar(80) NULL,
  ADD COLUMN evidence_key varchar(160) NULL,
  ADD COLUMN revision int NULL,
  ADD COLUMN evidence_hash char(64) NULL,
  ADD COLUMN definition_json json NULL,
  ADD UNIQUE KEY provider_official_evidence_revision_uq(provider_key, evidence_key, revision);
--> statement-breakpoint
CREATE TABLE provider_runtime_policies (
  id binary(16) PRIMARY KEY, provider_key varchar(80) NOT NULL, revision int NOT NULL,
  manifest_id binary(16) NOT NULL, evidence_id binary(16) NOT NULL,
  definition_hash char(64) NOT NULL, definition_json json NOT NULL, created_at datetime(6) NOT NULL,
  UNIQUE KEY provider_runtime_policy_revision_uq(provider_key, revision),
  KEY provider_runtime_policy_manifest_idx(manifest_id),
  FOREIGN KEY(manifest_id) REFERENCES provider_capability_manifests(id) ON DELETE restrict,
  FOREIGN KEY(evidence_id) REFERENCES provider_capability_evidence(id) ON DELETE restrict
);
