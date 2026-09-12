CREATE TABLE verification_policies (
  id binary(16) PRIMARY KEY, policy_key varchar(100) NOT NULL, revision varchar(32) NOT NULL,
  definition_json json NOT NULL, definition_hash char(64) NOT NULL, created_at datetime(6) NOT NULL,
  UNIQUE KEY verification_policy_revision_uq(policy_key, revision)
);
--> statement-breakpoint
CREATE TABLE reconciliation_cases (
  id binary(16) PRIMARY KEY, user_id binary(16) NOT NULL, execution_id binary(16) NOT NULL,
  execution_step_id binary(16) NOT NULL, operation_id binary(16) NOT NULL, policy_id binary(16) NOT NULL,
  policy_snapshot_json json NOT NULL, policy_hash char(64) NOT NULL, status varchar(32) NOT NULL,
  result_state varchar(32) NOT NULL, attempt_count int NOT NULL DEFAULT 0, next_attempt_at datetime(6) NOT NULL,
  lease_token varchar(64) NULL, lease_until datetime(6) NULL, expires_at datetime(6) NOT NULL, resolved_at datetime(6) NULL,
  created_at datetime(6) NOT NULL, updated_at datetime(6) NOT NULL,
  UNIQUE KEY reconciliation_operation_uq(operation_id), KEY reconciliation_due_idx(status, next_attempt_at, lease_until),
  KEY reconciliation_user_created_idx(user_id, created_at),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE restrict,
  FOREIGN KEY(execution_id) REFERENCES executions(id) ON DELETE restrict,
  FOREIGN KEY(execution_step_id) REFERENCES execution_steps(id) ON DELETE restrict,
  FOREIGN KEY(operation_id) REFERENCES side_effect_operations(id) ON DELETE restrict,
  FOREIGN KEY(policy_id) REFERENCES verification_policies(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE verification_evidence (
  id binary(16) PRIMARY KEY, user_id binary(16) NOT NULL, operation_id binary(16) NOT NULL, case_id binary(16) NULL,
  action_intent_id binary(16) NULL, policy_id binary(16) NOT NULL, method varchar(32) NOT NULL,
  result_state varchar(32) NOT NULL, evidence_key varchar(100) NOT NULL, evidence_json json NOT NULL,
  evidence_hash char(64) NOT NULL, verified_at datetime(6) NOT NULL,
  UNIQUE KEY verification_evidence_operation_key_uq(operation_id, evidence_key), KEY verification_evidence_case_idx(case_id, verified_at),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE restrict,
  FOREIGN KEY(operation_id) REFERENCES side_effect_operations(id) ON DELETE restrict,
  FOREIGN KEY(case_id) REFERENCES reconciliation_cases(id) ON DELETE restrict,
  FOREIGN KEY(action_intent_id) REFERENCES action_intents(id) ON DELETE restrict,
  FOREIGN KEY(policy_id) REFERENCES verification_policies(id) ON DELETE restrict
);
