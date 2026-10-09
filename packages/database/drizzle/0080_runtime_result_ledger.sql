CREATE TABLE runtime_results (
 id BINARY(16) PRIMARY KEY,user_id BINARY(16) NOT NULL,invocation_id BINARY(16) NOT NULL,target_id BINARY(16) NOT NULL,authority_epoch INT NOT NULL,
 result_hash CHAR(64) NOT NULL,payload_ref VARCHAR(255),evidence_refs JSON NOT NULL,execution_state VARCHAR(32) NOT NULL,verification_state VARCHAR(32) NOT NULL,
 delivery_attempt INT NOT NULL DEFAULT 0,last_delivered_at DATETIME(6),ack_token_hash CHAR(64),ack_at DATETIME(6),resume_cursor BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,created_at DATETIME(6) NOT NULL,expires_at DATETIME(6),
 UNIQUE KEY runtime_result_invocation_uq(invocation_id),UNIQUE KEY runtime_result_cursor_uq(resume_cursor),KEY runtime_result_owner_cursor_idx(user_id,resume_cursor),
 FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(invocation_id) REFERENCES capability_invocations(id),FOREIGN KEY(target_id) REFERENCES runtime_targets(id),CHECK(authority_epoch>0),CHECK(delivery_attempt>=0)
);
