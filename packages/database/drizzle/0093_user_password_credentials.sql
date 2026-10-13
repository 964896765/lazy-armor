CREATE TABLE password_credentials (
  id binary(16) NOT NULL PRIMARY KEY,
  user_id binary(16) NOT NULL,
  password_hash varchar(255) NOT NULL,
  algorithm varchar(24) NOT NULL,
  parameters_json json NOT NULL,
  version int NOT NULL DEFAULT 1,
  source_legacy_identity_id binary(16) NULL,
  changed_at datetime(6) NOT NULL,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  UNIQUE KEY password_credentials_user_uq (user_id),
  CONSTRAINT password_credentials_user_fk FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT password_credentials_legacy_fk FOREIGN KEY (source_legacy_identity_id) REFERENCES auth_identities(id),
  CONSTRAINT password_credentials_version_ck CHECK (version > 0)
);
