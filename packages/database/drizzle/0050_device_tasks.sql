CREATE TABLE device_heartbeats (
  id binary(16) NOT NULL,
  user_id binary(16) NOT NULL,
  trusted_device_id binary(16) NOT NULL,
  device_id varchar(128) NOT NULL,
  online_state varchar(32) NOT NULL,
  last_heartbeat_at datetime(6) NOT NULL,
  created_at datetime(6) NOT NULL,
  CONSTRAINT device_heartbeats_id PRIMARY KEY(id),
  CONSTRAINT device_heartbeats_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict,
  CONSTRAINT device_heartbeats_device_fk FOREIGN KEY (trusted_device_id) REFERENCES trusted_devices(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX device_heartbeats_user_device_uq ON device_heartbeats (user_id, trusted_device_id);
--> statement-breakpoint
CREATE INDEX device_heartbeats_user_heartbeat_idx ON device_heartbeats (user_id, last_heartbeat_at);
--> statement-breakpoint
CREATE TABLE device_tasks (
  id binary(16) NOT NULL,
  user_id binary(16) NOT NULL,
  trusted_device_id binary(16) NOT NULL,
  device_id varchar(128) NOT NULL,
  task_type varchar(64) NOT NULL,
  fact_key varchar(180) NOT NULL,
  resource_type varchar(120) NOT NULL,
  payload_json json NOT NULL,
  status varchar(32) NOT NULL,
  claim_token char(64),
  claimed_at datetime(6),
  lease_expires_at datetime(6),
  result_json json,
  result_hash char(64),
  error_code varchar(120),
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  completed_at datetime(6),
  CONSTRAINT device_tasks_id PRIMARY KEY(id),
  CONSTRAINT device_tasks_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE restrict,
  CONSTRAINT device_tasks_device_fk FOREIGN KEY (trusted_device_id) REFERENCES trusted_devices(id) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX device_tasks_claim_token_uq ON device_tasks (claim_token);
--> statement-breakpoint
CREATE INDEX device_tasks_user_status_idx ON device_tasks (user_id, status);
--> statement-breakpoint
CREATE INDEX device_tasks_user_created_idx ON device_tasks (user_id, created_at);
