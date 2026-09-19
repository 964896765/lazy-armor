CREATE TABLE read_evidence (
  id binary(16) NOT NULL,
  user_id binary(16) NOT NULL,
  request_id varchar(64) NOT NULL,
  source_type varchar(32) NOT NULL,
  resource_type varchar(120) NOT NULL,
  resource_id varchar(255),
  read_method varchar(32) NOT NULL,
  parser_id varchar(120) NOT NULL,
  content_hash char(64) NOT NULL,
  evidence_hash char(64) NOT NULL,
  source_identity varchar(255),
  resource_identity varchar(255),
  status varchar(32) NOT NULL,
  confidence int NOT NULL,
  observation_id binary(16),
  candidate_ids_json json,
  truth_record_ids_json json,
  blocked_reason varchar(255),
  warnings_json json,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  CONSTRAINT read_evidence_id PRIMARY KEY(id),
  CONSTRAINT read_evidence_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict,
  CONSTRAINT read_evidence_observation_fk FOREIGN KEY (observation_id) REFERENCES source_observations(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX read_evidence_user_request_uq ON read_evidence (user_id, request_id);
--> statement-breakpoint
CREATE INDEX read_evidence_user_created_idx ON read_evidence (user_id, created_at);
--> statement-breakpoint
CREATE INDEX read_evidence_observation_idx ON read_evidence (observation_id);
