CREATE TABLE cost_budgets (
  id BINARY(16) NOT NULL,
  budget_key VARCHAR(255) NOT NULL,
  scope_type VARCHAR(32) NOT NULL,
  user_id BINARY(16) NULL,
  provider VARCHAR(80) NULL,
  monthly_limit_minor INT NOT NULL,
  currency VARCHAR(8) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cost_budgets_key_uq (budget_key),
  KEY cost_budgets_user_status_idx (user_id, status),
  KEY cost_budgets_provider_status_idx (provider, status),
  CONSTRAINT cost_budgets_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT cost_budgets_limit_check CHECK (monthly_limit_minor >= 0),
  CONSTRAINT cost_budgets_scope_check CHECK (scope_type IN ('user','provider'))
);
