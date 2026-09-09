CREATE TABLE strategy_runtime_bindings (
  id binary(16) NOT NULL,
  user_id binary(16) NOT NULL,
  plan_version_id binary(16) NOT NULL,
  scenario_key varchar(120) NOT NULL,
  scenario_revision int NOT NULL,
  strategy_key varchar(64) NOT NULL,
  strategy_revision int NOT NULL,
  schema_version varchar(16) NOT NULL,
  runtime_hash char(64) NOT NULL,
  runtime_json json NOT NULL,
  created_at datetime(6) NOT NULL,
  CONSTRAINT strategy_runtime_bindings_id PRIMARY KEY(id),
  CONSTRAINT strategy_runtime_bindings_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict,
  CONSTRAINT strategy_runtime_bindings_version_fk FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX strategy_runtime_bindings_plan_version_uq ON strategy_runtime_bindings (plan_version_id);
--> statement-breakpoint
CREATE INDEX strategy_runtime_bindings_user_strategy_idx ON strategy_runtime_bindings (user_id, strategy_key, created_at);
--> statement-breakpoint
CREATE TABLE truth_fact_dependencies (
  id binary(16) NOT NULL,
  binding_id binary(16) NOT NULL,
  user_id binary(16) NOT NULL,
  plan_version_id binary(16) NOT NULL,
  dependency_key char(64) NOT NULL,
  fact_key varchar(180) NOT NULL,
  resource_type varchar(120) NOT NULL,
  field varchar(120) NOT NULL,
  scope varchar(32) NOT NULL,
  subject_key varchar(255),
  created_at datetime(6) NOT NULL,
  CONSTRAINT truth_fact_dependencies_id PRIMARY KEY(id),
  CONSTRAINT truth_fact_dependencies_binding_fk FOREIGN KEY (binding_id) REFERENCES strategy_runtime_bindings(id) ON DELETE restrict,
  CONSTRAINT truth_fact_dependencies_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict,
  CONSTRAINT truth_fact_dependencies_version_fk FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX truth_fact_dependencies_key_uq ON truth_fact_dependencies (dependency_key);
--> statement-breakpoint
CREATE INDEX truth_fact_dependencies_lookup_idx ON truth_fact_dependencies (user_id, fact_key, resource_type, scope);
--> statement-breakpoint
CREATE INDEX truth_fact_dependencies_subject_idx ON truth_fact_dependencies (user_id, subject_key, fact_key);
--> statement-breakpoint
CREATE TABLE strategy_runtime_wakeups (
  id binary(16) NOT NULL,
  binding_id binary(16) NOT NULL,
  user_id binary(16) NOT NULL,
  plan_version_id binary(16) NOT NULL,
  truth_record_version_id binary(16) NOT NULL,
  wakeup_key char(64) NOT NULL,
  fact_key varchar(180) NOT NULL,
  resource_type varchar(120) NOT NULL,
  subject_key varchar(255) NOT NULL,
  trigger_mode varchar(32) NOT NULL,
  status varchar(32) NOT NULL,
  created_at datetime(6) NOT NULL,
  evaluated_at datetime(6),
  CONSTRAINT strategy_runtime_wakeups_id PRIMARY KEY(id),
  CONSTRAINT strategy_runtime_wakeups_binding_fk FOREIGN KEY (binding_id) REFERENCES strategy_runtime_bindings(id) ON DELETE restrict,
  CONSTRAINT strategy_runtime_wakeups_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict,
  CONSTRAINT strategy_runtime_wakeups_version_fk FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE restrict,
  CONSTRAINT strategy_runtime_wakeups_truth_fk FOREIGN KEY (truth_record_version_id) REFERENCES truth_record_versions(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX strategy_runtime_wakeups_key_uq ON strategy_runtime_wakeups (wakeup_key);
--> statement-breakpoint
CREATE INDEX strategy_runtime_wakeups_user_status_idx ON strategy_runtime_wakeups (user_id, status, created_at);
--> statement-breakpoint
CREATE TABLE strategy_runtime_decisions (
  id binary(16) NOT NULL,
  binding_id binary(16) NOT NULL,
  wakeup_id binary(16) NOT NULL,
  user_id binary(16) NOT NULL,
  input_hash char(64) NOT NULL,
  decision_hash char(64) NOT NULL,
  trigger_decision_json json NOT NULL,
  condition_decision_json json NOT NULL,
  lifecycle_trace_json json NOT NULL,
  result varchar(32) NOT NULL,
  evaluated_at datetime(6) NOT NULL,
  CONSTRAINT strategy_runtime_decisions_id PRIMARY KEY(id),
  CONSTRAINT strategy_runtime_decisions_binding_fk FOREIGN KEY (binding_id) REFERENCES strategy_runtime_bindings(id) ON DELETE restrict,
  CONSTRAINT strategy_runtime_decisions_wakeup_fk FOREIGN KEY (wakeup_id) REFERENCES strategy_runtime_wakeups(id) ON DELETE restrict,
  CONSTRAINT strategy_runtime_decisions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX strategy_runtime_decisions_wakeup_uq ON strategy_runtime_decisions (wakeup_id);
--> statement-breakpoint
CREATE INDEX strategy_runtime_decisions_user_time_idx ON strategy_runtime_decisions (user_id, evaluated_at);
