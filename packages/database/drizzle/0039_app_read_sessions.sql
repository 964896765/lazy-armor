CREATE TABLE app_read_sessions (
  id binary(16) NOT NULL,
  user_id binary(16) NOT NULL,
  trusted_device_id binary(16) NOT NULL,
  device_app_connection_id binary(16) NOT NULL,
  target_package varchar(255) NOT NULL,
  modes_json json NOT NULL,
  status varchar(32) NOT NULL,
  active_device_key varchar(64),
  correlation_id char(64) NOT NULL,
  started_at datetime(6),
  last_heartbeat_at datetime(6),
  expires_at datetime(6) NOT NULL,
  ended_at datetime(6),
  terminal_reason varchar(120),
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  CONSTRAINT app_read_sessions_id PRIMARY KEY(id),
  CONSTRAINT app_read_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict,
  CONSTRAINT app_read_sessions_device_fk FOREIGN KEY (trusted_device_id) REFERENCES trusted_devices(id) ON DELETE restrict,
  CONSTRAINT app_read_sessions_connection_fk FOREIGN KEY (device_app_connection_id) REFERENCES device_app_connections(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX app_read_sessions_active_device_uq ON app_read_sessions (active_device_key);
--> statement-breakpoint
CREATE INDEX app_read_sessions_user_created_idx ON app_read_sessions (user_id, created_at);
--> statement-breakpoint
CREATE INDEX app_read_sessions_device_status_idx ON app_read_sessions (trusted_device_id, status, expires_at);
--> statement-breakpoint
CREATE TABLE app_read_session_events (
  id binary(16) NOT NULL,
  session_id binary(16) NOT NULL,
  user_id binary(16) NOT NULL,
  event_key char(64) NOT NULL,
  event_type varchar(40) NOT NULL,
  source_mode varchar(32),
  package_name varchar(255),
  payload_hash char(64) NOT NULL,
  evidence_hash char(64),
  payload_json json NOT NULL,
  observation_id binary(16),
  candidate_fact_id binary(16),
  created_at datetime(6) NOT NULL,
  CONSTRAINT app_read_session_events_id PRIMARY KEY(id),
  CONSTRAINT app_read_events_session_fk FOREIGN KEY (session_id) REFERENCES app_read_sessions(id) ON DELETE restrict,
  CONSTRAINT app_read_events_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict,
  CONSTRAINT app_read_events_observation_fk FOREIGN KEY (observation_id) REFERENCES source_observations(id) ON DELETE restrict,
  CONSTRAINT app_read_events_candidate_fk FOREIGN KEY (candidate_fact_id) REFERENCES candidate_facts(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX app_read_session_events_session_key_uq ON app_read_session_events (session_id, event_key);
--> statement-breakpoint
CREATE INDEX app_read_session_events_session_created_idx ON app_read_session_events (session_id, created_at);
--> statement-breakpoint
CREATE INDEX app_read_session_events_observation_idx ON app_read_session_events (observation_id);
