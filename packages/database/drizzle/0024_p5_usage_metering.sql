CREATE TABLE usage_events (
  id BINARY(16) NOT NULL,
  user_id BINARY(16) NOT NULL,
  usage_type VARCHAR(64) NOT NULL,
  quantity INT NOT NULL,
  unit VARCHAR(32) NOT NULL,
  provider VARCHAR(80) NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id VARCHAR(255) NOT NULL,
  execution_id BINARY(16) NULL,
  side_effect_operation_id BINARY(16) NULL,
  usage_identity VARCHAR(255) NOT NULL,
  billable INT NOT NULL DEFAULT 0,
  provider_cost_minor INT NULL,
  occurred_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY usage_events_identity_uq (usage_identity),
  KEY usage_events_user_time_type_idx (user_id, occurred_at, usage_type),
  KEY usage_events_execution_idx (execution_id, usage_type),
  KEY usage_events_side_effect_idx (side_effect_operation_id, usage_type),
  CONSTRAINT usage_events_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT usage_events_execution_id_executions_id_fk FOREIGN KEY (execution_id) REFERENCES executions (id) ON DELETE RESTRICT,
  CONSTRAINT usage_events_side_effect_operation_id_fk FOREIGN KEY (side_effect_operation_id) REFERENCES side_effect_operations (id) ON DELETE RESTRICT,
  CONSTRAINT usage_events_quantity_check CHECK (quantity >= 0),
  CONSTRAINT usage_events_billable_check CHECK (billable IN (0, 1))
);
--> statement-breakpoint
CREATE TRIGGER usage_events_no_update BEFORE UPDATE ON usage_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Usage event is append-only';
--> statement-breakpoint
CREATE TRIGGER usage_events_no_delete BEFORE DELETE ON usage_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Usage event is append-only';
