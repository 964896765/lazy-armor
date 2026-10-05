CREATE TABLE IF NOT EXISTS login_identifiers (
 id BINARY(16) PRIMARY KEY, user_id BINARY(16) NOT NULL,
 kind VARCHAR(10) NOT NULL, identifier VARCHAR(320) NOT NULL,
 verified_at DATETIME(6) NOT NULL, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
 UNIQUE KEY login_identifiers_kind_value_uq(kind,identifier),
 FOREIGN KEY(user_id) REFERENCES users(id)
);
