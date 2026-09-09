ALTER TABLE truth_records MODIFY source_receipt_id BINARY(16) NULL;
--> statement-breakpoint
CREATE TABLE reality_adapter_definitions (
  id BINARY(16) NOT NULL, adapter_key VARCHAR(120) NOT NULL, adapter_kind VARCHAR(32) NOT NULL, revision INT NOT NULL, definition_hash CHAR(64) NOT NULL, status VARCHAR(32) NOT NULL, definition_json JSON NOT NULL, created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY reality_adapter_definitions_key_revision_uq (adapter_key, revision), UNIQUE KEY reality_adapter_definitions_hash_uq (definition_hash)
);
--> statement-breakpoint
CREATE TABLE reality_policy_definitions (
  id BINARY(16) NOT NULL, policy_key VARCHAR(120) NOT NULL, policy_kind VARCHAR(32) NOT NULL, revision INT NOT NULL, definition_hash CHAR(64) NOT NULL, status VARCHAR(32) NOT NULL, definition_json JSON NOT NULL, created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY reality_policy_definitions_key_revision_uq (policy_key, revision), UNIQUE KEY reality_policy_definitions_hash_uq (definition_hash)
);
--> statement-breakpoint
CREATE TABLE source_observations (
  id BINARY(16) NOT NULL, user_id BINARY(16) NOT NULL, connection_id BINARY(16) NULL, source_mode VARCHAR(32) NOT NULL, provider_key VARCHAR(80) NOT NULL, external_event_key VARCHAR(255) NOT NULL, source_identity CHAR(64) NOT NULL, parser_key VARCHAR(120) NOT NULL, resource_hint VARCHAR(120) NOT NULL, payload_hash CHAR(64) NOT NULL, evidence_hash CHAR(64) NOT NULL, payload_json JSON NOT NULL, status VARCHAR(32) NOT NULL, observed_at DATETIME(6) NOT NULL, occurred_at DATETIME(6) NULL, received_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY source_observations_user_identity_uq (user_id, source_identity), KEY source_observations_user_time_idx (user_id, received_at), CONSTRAINT source_observations_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT, CONSTRAINT source_observations_connection_id_fk FOREIGN KEY (connection_id) REFERENCES connections (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE candidate_facts (
  id BINARY(16) NOT NULL, user_id BINARY(16) NOT NULL, observation_id BINARY(16) NOT NULL, resource_type VARCHAR(120) NOT NULL, resource_key VARCHAR(255) NOT NULL, subject_key VARCHAR(255) NOT NULL, fact_key VARCHAR(180) NOT NULL, value_json JSON NOT NULL, value_hash CHAR(64) NOT NULL, dedupe_key CHAR(64) NOT NULL, confidence INT NOT NULL, normalizer_key VARCHAR(120) NOT NULL, freshness_policy_key VARCHAR(120) NOT NULL, conflict_policy_key VARCHAR(120) NOT NULL, compatibility_resource_key VARCHAR(120) NULL, status VARCHAR(32) NOT NULL, truth_record_id BINARY(16) NULL, decided_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY candidate_facts_user_dedupe_uq (user_id, dedupe_key), KEY candidate_facts_user_status_idx (user_id, status, created_at), CONSTRAINT candidate_facts_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT, CONSTRAINT candidate_facts_observation_id_fk FOREIGN KEY (observation_id) REFERENCES source_observations (id) ON DELETE RESTRICT, CONSTRAINT candidate_facts_truth_record_id_fk FOREIGN KEY (truth_record_id) REFERENCES truth_records (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE truth_provenance (
  id BINARY(16) NOT NULL, truth_record_version_id BINARY(16) NOT NULL, candidate_fact_id BINARY(16) NOT NULL, observation_id BINARY(16) NOT NULL, provider_key VARCHAR(80) NOT NULL, source_mode VARCHAR(32) NOT NULL, evidence_hash CHAR(64) NOT NULL, observed_at DATETIME(6) NOT NULL, created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY truth_provenance_version_candidate_uq (truth_record_version_id, candidate_fact_id), UNIQUE KEY truth_provenance_candidate_uq (candidate_fact_id), KEY truth_provenance_observation_idx (observation_id), CONSTRAINT truth_provenance_version_id_fk FOREIGN KEY (truth_record_version_id) REFERENCES truth_record_versions (id) ON DELETE RESTRICT, CONSTRAINT truth_provenance_candidate_id_fk FOREIGN KEY (candidate_fact_id) REFERENCES candidate_facts (id) ON DELETE RESTRICT, CONSTRAINT truth_provenance_observation_id_fk FOREIGN KEY (observation_id) REFERENCES source_observations (id) ON DELETE RESTRICT
);
