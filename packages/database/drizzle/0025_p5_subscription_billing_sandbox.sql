CREATE TABLE subscription_customers (
  id BINARY(16) NOT NULL,
  user_id BINARY(16) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  external_customer_id VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY subscription_customers_user_provider_uq (user_id, provider),
  UNIQUE KEY subscription_customers_provider_external_uq (provider, external_customer_id),
  CONSTRAINT subscription_customers_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE subscriptions (
  id BINARY(16) NOT NULL,
  user_id BINARY(16) NOT NULL,
  subscription_customer_id BINARY(16) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  external_subscription_id VARCHAR(255) NOT NULL,
  checkout_request_id VARCHAR(255) NOT NULL,
  external_checkout_id VARCHAR(255) NOT NULL,
  checkout_url VARCHAR(1024) NOT NULL,
  membership_plan_key VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  current_period_start DATETIME(6) NULL,
  current_period_end DATETIME(6) NULL,
  cancel_at_period_end INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY subscriptions_provider_external_uq (provider, external_subscription_id),
  UNIQUE KEY subscriptions_user_checkout_request_uq (user_id, checkout_request_id),
  KEY subscriptions_user_status_idx (user_id, status, updated_at),
  CONSTRAINT subscriptions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT subscriptions_customer_id_fk FOREIGN KEY (subscription_customer_id) REFERENCES subscription_customers (id) ON DELETE RESTRICT,
  CONSTRAINT subscriptions_plan_key_fk FOREIGN KEY (membership_plan_key) REFERENCES membership_plans (plan_key) ON DELETE RESTRICT,
  CONSTRAINT subscriptions_cancel_check CHECK (cancel_at_period_end IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE subscription_events (
  id BINARY(16) NOT NULL,
  user_id BINARY(16) NOT NULL,
  subscription_id BINARY(16) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  external_event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  payload_snapshot_json JSON NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  received_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY subscription_events_provider_event_uq (provider, external_event_id),
  KEY subscription_events_subscription_time_idx (subscription_id, occurred_at),
  KEY subscription_events_user_time_idx (user_id, occurred_at),
  CONSTRAINT subscription_events_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT subscription_events_subscription_id_fk FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TRIGGER subscription_events_no_update BEFORE UPDATE ON subscription_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Subscription event is append-only';
--> statement-breakpoint
CREATE TRIGGER subscription_events_no_delete BEFORE DELETE ON subscription_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Subscription event is append-only';
