ALTER TABLE action_adapter_bindings ADD COLUMN capability_resolution_decision_id binary(16) NULL;
--> statement-breakpoint
ALTER TABLE action_adapter_bindings ADD COLUMN capability_resolution_decision_hash char(64) NULL;
--> statement-breakpoint
ALTER TABLE action_adapter_bindings ADD CONSTRAINT action_adapter_resolution_fk FOREIGN KEY (capability_resolution_decision_id) REFERENCES capability_resolution_decisions(id) ON DELETE restrict;
