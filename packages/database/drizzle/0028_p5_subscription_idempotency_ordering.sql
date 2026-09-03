ALTER TABLE subscriptions ADD COLUMN last_applied_occurred_at DATETIME(6) NULL;
--> statement-breakpoint
CREATE TABLE subscription_cancellation_requests (
  id BINARY(16) NOT NULL,
  user_id BINARY(16) NOT NULL,
  subscription_id BINARY(16) NOT NULL,
  request_id VARCHAR(255) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY subscription_cancellation_requests_user_request_uq (user_id, request_id),
  KEY subscription_cancellation_requests_subscription_idx (subscription_id, created_at),
  CONSTRAINT subscription_cancellation_requests_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT subscription_cancellation_requests_subscription_id_fk FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE RESTRICT
);
