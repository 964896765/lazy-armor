ALTER TABLE login_identifiers ADD COLUMN disabled_at datetime(6) NULL;
--> statement-breakpoint
CREATE TABLE auth_security_notices (
  id binary(16) NOT NULL PRIMARY KEY,
  user_id binary(16) NOT NULL,
  event_id binary(16) NOT NULL,
  channel varchar(10) NOT NULL,
  recipient_cipher text NOT NULL,
  masked varchar(320) NOT NULL,
  state varchar(24) NOT NULL DEFAULT 'PENDING',
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at datetime(6) NOT NULL,
  claimed_at datetime(6) NULL,
  provider_key char(64) NULL,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  INDEX auth_security_notices_pending_idx (state,next_attempt_at),
  INDEX auth_security_notices_user_idx (user_id,created_at),
  CONSTRAINT auth_security_notices_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT auth_security_notices_state_ck CHECK (state IN ('PENDING','CLAIMED','ACCEPTED','UNKNOWN','BLOCKED')),
  CONSTRAINT auth_security_notices_channel_ck CHECK (channel IN ('phone','email')),
  CONSTRAINT auth_security_notices_attempts_ck CHECK (attempts BETWEEN 0 AND 5)
);
