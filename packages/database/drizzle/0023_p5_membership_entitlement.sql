CREATE TABLE membership_plans (
  id BINARY(16) NOT NULL,
  plan_key VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL,
  version INT NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY membership_plans_plan_key_uq (plan_key)
);
--> statement-breakpoint

CREATE TABLE user_memberships (
  id BINARY(16) NOT NULL,
  user_id BINARY(16) NOT NULL,
  membership_plan_key VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  started_at DATETIME(6) NOT NULL,
  current_period_start DATETIME(6) NULL,
  current_period_end DATETIME(6) NULL,
  cancel_at_period_end INT NOT NULL DEFAULT 0,
  provider VARCHAR(64) NOT NULL,
  external_subscription_id VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY user_memberships_user_uq (user_id),
  UNIQUE KEY user_memberships_provider_subscription_uq (provider, external_subscription_id),
  KEY user_memberships_status_period_idx (status, current_period_end),
  CONSTRAINT user_memberships_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT user_memberships_plan_key_membership_plans_plan_key_fk FOREIGN KEY (membership_plan_key) REFERENCES membership_plans (plan_key) ON DELETE RESTRICT
);
--> statement-breakpoint

INSERT INTO membership_plans (
  id, plan_key, name, status, version, created_at, updated_at
) VALUES
  (UUID_TO_BIN('00000000-0000-4000-8000-000000000101'), 'free', '免费版', 'active', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
  (UUID_TO_BIN('00000000-0000-4000-8000-000000000102'), 'plus', 'Plus', 'active', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6));
--> statement-breakpoint

INSERT INTO user_memberships (
  id, user_id, membership_plan_key, status, started_at,
  current_period_start, current_period_end, cancel_at_period_end,
  provider, external_subscription_id, created_at, updated_at
)
SELECT
  UUID_TO_BIN(UUID()), id, 'free', 'active', UTC_TIMESTAMP(6),
  UTC_TIMESTAMP(6), NULL, 0, 'internal', NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
FROM users;
