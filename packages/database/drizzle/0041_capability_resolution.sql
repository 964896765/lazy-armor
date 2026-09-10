CREATE TABLE capability_resolution_decisions (
  id binary(16) NOT NULL PRIMARY KEY,
  user_id binary(16) NOT NULL,
  plan_version_id binary(16) NOT NULL,
  request_key varchar(120) NOT NULL,
  request_hash char(64) NOT NULL,
  decision_hash char(64) NOT NULL,
  input_json json NOT NULL,
  decision_json json NOT NULL,
  created_at datetime(6) NOT NULL,
  CONSTRAINT cap_resolution_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict,
  CONSTRAINT cap_resolution_version_fk FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX cap_resolution_request_uq ON capability_resolution_decisions (user_id, request_key);
--> statement-breakpoint
CREATE INDEX cap_resolution_version_idx ON capability_resolution_decisions (plan_version_id, created_at);
