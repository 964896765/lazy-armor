CREATE TABLE resource_catalog_definitions (
  id BINARY(16) NOT NULL, resource_key VARCHAR(100) NOT NULL, schema_version VARCHAR(16) NOT NULL, revision INT NOT NULL,
  definition_hash CHAR(64) NOT NULL, status VARCHAR(32) NOT NULL, definition_json JSON NOT NULL, superseded_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY resource_catalog_definitions_key_revision_uq (resource_key, revision), UNIQUE KEY resource_catalog_definitions_hash_uq (definition_hash), KEY resource_catalog_definitions_status_idx (status, resource_key)
);
--> statement-breakpoint
CREATE TABLE fact_schema_definitions (
  id BINARY(16) NOT NULL, fact_key VARCHAR(180) NOT NULL, resource_key VARCHAR(100) NOT NULL, schema_version VARCHAR(16) NOT NULL, revision INT NOT NULL,
  definition_hash CHAR(64) NOT NULL, status VARCHAR(32) NOT NULL, definition_json JSON NOT NULL, superseded_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY fact_schema_definitions_key_revision_uq (fact_key, revision), UNIQUE KEY fact_schema_definitions_hash_uq (definition_hash), KEY fact_schema_definitions_resource_status_idx (resource_key, status)
);
--> statement-breakpoint
CREATE TABLE strategy_profile_definitions (
  id BINARY(16) NOT NULL, strategy_key VARCHAR(64) NOT NULL, schema_version VARCHAR(16) NOT NULL, revision INT NOT NULL,
  definition_hash CHAR(64) NOT NULL, status VARCHAR(32) NOT NULL, definition_json JSON NOT NULL, superseded_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY strategy_profile_definitions_key_revision_uq (strategy_key, revision), UNIQUE KEY strategy_profile_definitions_hash_uq (definition_hash), KEY strategy_profile_definitions_status_idx (status, strategy_key)
);
--> statement-breakpoint
CREATE TABLE scenario_definitions (
  id BINARY(16) NOT NULL, scenario_key VARCHAR(120) NOT NULL, domain_key VARCHAR(64) NOT NULL, schema_version VARCHAR(16) NOT NULL, revision INT NOT NULL,
  definition_hash CHAR(64) NOT NULL, status VARCHAR(32) NOT NULL, definition_json JSON NOT NULL, superseded_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY scenario_definitions_key_revision_uq (scenario_key, revision), UNIQUE KEY scenario_definitions_hash_uq (definition_hash), KEY scenario_definitions_domain_status_idx (domain_key, status)
);
--> statement-breakpoint
CREATE TABLE scenario_readiness_snapshots (
  id BINARY(16) NOT NULL, user_id BINARY(16) NOT NULL, scenario_key VARCHAR(120) NOT NULL, scenario_revision INT NOT NULL,
  state VARCHAR(32) NOT NULL, snapshot_json JSON NOT NULL, evaluated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id), KEY scenario_readiness_user_scenario_idx (user_id, scenario_key, evaluated_at),
  CONSTRAINT scenario_readiness_snapshots_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
);
