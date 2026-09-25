ALTER TABLE action_adapter_bindings ADD COLUMN resolution_contract_json json NULL;
--> statement-breakpoint
ALTER TABLE action_adapter_bindings ADD COLUMN resolution_contract_hash char(64) NULL;
--> statement-breakpoint
ALTER TABLE action_adapter_bindings ADD COLUMN verification_policy_key varchar(160) NULL;
--> statement-breakpoint
ALTER TABLE action_adapter_bindings ADD COLUMN verification_policy_revision varchar(32) NULL;
--> statement-breakpoint
ALTER TABLE action_adapter_bindings ADD COLUMN verification_policy_hash char(64) NULL;
--> statement-breakpoint
ALTER TABLE action_adapter_bindings ADD COLUMN verification_contract_json json NULL;
--> statement-breakpoint
ALTER TABLE action_adapter_bindings ADD COLUMN verification_contract_hash char(64) NULL;
