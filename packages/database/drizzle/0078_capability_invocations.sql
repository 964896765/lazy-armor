CREATE TABLE capability_invocations (
 id BINARY(16) PRIMARY KEY,user_id BINARY(16) NOT NULL,plan_id BINARY(16) NOT NULL,plan_version_id BINARY(16) NOT NULL,execution_id BINARY(16),action_intent_id BINARY(16),
 capability_id VARCHAR(120) NOT NULL,target_id BINARY(16) NOT NULL,authority_epoch INT NOT NULL,target_manifest_hash CHAR(64) NOT NULL,
 arguments JSON NOT NULL,resource_scope JSON NOT NULL,timeout_ms INT NOT NULL,idempotency_key VARCHAR(255) NOT NULL,
 resolution_decision_ref BINARY(16) NOT NULL,risk_snapshot_ref VARCHAR(255),approval_ref VARCHAR(255),verification_contract_ref VARCHAR(255),invocation_hash CHAR(64) NOT NULL,created_at DATETIME(6) NOT NULL,
 UNIQUE KEY cap_invocation_owner_idempotency_uq(user_id,idempotency_key),UNIQUE KEY cap_invocation_intent_uq(action_intent_id),
 FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(plan_id) REFERENCES plans(id),FOREIGN KEY(plan_version_id) REFERENCES plan_versions(id),FOREIGN KEY(execution_id) REFERENCES executions(id),FOREIGN KEY(action_intent_id) REFERENCES action_intents(id),FOREIGN KEY(target_id) REFERENCES runtime_targets(id),FOREIGN KEY(capability_id) REFERENCES capability_identities(id),FOREIGN KEY(resolution_decision_ref) REFERENCES capability_resolution_decisions(id),CHECK(authority_epoch>0),CHECK(timeout_ms>0 AND timeout_ms<=3600000)
);
