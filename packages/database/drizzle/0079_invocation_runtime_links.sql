CREATE TABLE invocation_runtime_links (
 id BINARY(16) PRIMARY KEY,invocation_id BINARY(16) NOT NULL,runtime_kind VARCHAR(32) NOT NULL,runtime_ref BINARY(16) NOT NULL,created_at DATETIME(6) NOT NULL,
 UNIQUE KEY invocation_runtime_link_uq(invocation_id,runtime_kind,runtime_ref),FOREIGN KEY(invocation_id) REFERENCES capability_invocations(id)
);
