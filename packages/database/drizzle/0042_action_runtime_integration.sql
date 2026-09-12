CREATE TABLE action_intents (
  id binary(16) NOT NULL PRIMARY KEY,
  user_id binary(16) NOT NULL,
  plan_id binary(16) NOT NULL,
  plan_version_id binary(16) NOT NULL,
  plan_action_id binary(16) NOT NULL,
  execution_id binary(16) NOT NULL,
  schema_version varchar(16) NOT NULL,
  action_type varchar(64) NOT NULL,
  capability_key varchar(100),
  resource_type varchar(120) NOT NULL,
  target_json json NOT NULL,
  payload_json json NOT NULL,
  payload_hash char(64) NOT NULL,
  desired_outcome varchar(500) NOT NULL,
  side_effect_key varchar(255),
  provider_risk_floor varchar(8) NOT NULL,
  scenario_risk_floor varchar(8) NOT NULL,
  action_risk varchar(8) NOT NULL,
  context_risk_elevation varchar(8) NOT NULL,
  effective_risk_level varchar(8) NOT NULL,
  context_signals_json json NOT NULL,
  intent_hash char(64) NOT NULL,
  status varchar(32) NOT NULL,
  created_at datetime(6) NOT NULL,
  CONSTRAINT action_intents_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict,
  CONSTRAINT action_intents_plan_fk FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE restrict,
  CONSTRAINT action_intents_version_fk FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE restrict,
  CONSTRAINT action_intents_action_fk FOREIGN KEY (plan_action_id) REFERENCES plan_actions(id) ON DELETE restrict,
  CONSTRAINT action_intents_execution_fk FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX action_intents_execution_action_uq ON action_intents (execution_id, plan_action_id);
--> statement-breakpoint
CREATE UNIQUE INDEX action_intents_hash_uq ON action_intents (intent_hash);
--> statement-breakpoint
CREATE INDEX action_intents_user_created_idx ON action_intents (user_id, created_at);
--> statement-breakpoint
CREATE TABLE action_adapter_bindings (
  id binary(16) NOT NULL PRIMARY KEY,
  action_intent_id binary(16) NOT NULL,
  adapter_revision int NOT NULL,
  adapter_key varchar(160) NOT NULL,
  connector_id binary(16),
  connection_id binary(16),
  capability_key varchar(100),
  binding_hash char(64) NOT NULL,
  status varchar(32) NOT NULL,
  created_at datetime(6) NOT NULL,
  CONSTRAINT action_adapter_intent_fk FOREIGN KEY (action_intent_id) REFERENCES action_intents(id) ON DELETE restrict,
  CONSTRAINT action_adapter_connector_fk FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE restrict,
  CONSTRAINT action_adapter_connection_fk FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX action_adapter_bindings_intent_uq ON action_adapter_bindings (action_intent_id);
--> statement-breakpoint
CREATE UNIQUE INDEX action_adapter_bindings_hash_uq ON action_adapter_bindings (binding_hash);
--> statement-breakpoint
ALTER TABLE execution_steps ADD COLUMN action_intent_id binary(16) NULL;
--> statement-breakpoint
ALTER TABLE execution_steps ADD CONSTRAINT execution_steps_action_intent_fk FOREIGN KEY (action_intent_id) REFERENCES action_intents(id) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX execution_steps_action_intent_idx ON execution_steps (action_intent_id);
--> statement-breakpoint
ALTER TABLE approval_requests ADD COLUMN approval_snapshot_json json NULL;
--> statement-breakpoint
ALTER TABLE approval_requests ADD COLUMN approval_snapshot_hash char(64) NULL;
