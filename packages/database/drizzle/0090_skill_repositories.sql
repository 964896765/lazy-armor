CREATE TABLE skill_repositories (
  id binary(16) NOT NULL PRIMARY KEY,
  user_id binary(16) NOT NULL,
  request_id varchar(160) NOT NULL,
  import_hash char(64) NOT NULL,
  name varchar(120) NOT NULL,
  source_type varchar(32) NOT NULL,
  source_url varchar(1000) NULL,
  enabled boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL,
  version int NOT NULL,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  UNIQUE KEY skill_repository_request_uq (user_id, request_id),
  KEY skill_repository_owner_idx (user_id, created_at, id),
  CONSTRAINT skill_repository_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE skill_entries (
  id binary(16) NOT NULL PRIMARY KEY,
  repository_id binary(16) NOT NULL,
  name varchar(80) NOT NULL,
  current_revision_id binary(16) NULL,
  created_at datetime(6) NOT NULL,
  UNIQUE KEY skill_entry_name_uq (repository_id, name),
  CONSTRAINT skill_entry_repository_fk FOREIGN KEY (repository_id) REFERENCES skill_repositories(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE skill_entry_revisions (
  id binary(16) NOT NULL PRIMARY KEY,
  entry_id binary(16) NOT NULL,
  version varchar(40) NOT NULL,
  content_hash char(64) NOT NULL,
  manifest_json json NOT NULL,
  created_at datetime(6) NOT NULL,
  UNIQUE KEY skill_entry_revision_uq (entry_id, version),
  CONSTRAINT skill_revision_entry_fk FOREIGN KEY (entry_id) REFERENCES skill_entries(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE plan_skill_references (
  id binary(16) NOT NULL PRIMARY KEY,
  user_id binary(16) NOT NULL,
  plan_version_id binary(16) NOT NULL,
  revision_id binary(16) NOT NULL,
  content_hash char(64) NOT NULL,
  repository_version int NOT NULL,
  created_at datetime(6) NOT NULL,
  UNIQUE KEY plan_skill_reference_uq (plan_version_id, revision_id),
  KEY plan_skill_reference_owner_idx (user_id, plan_version_id),
  CONSTRAINT plan_skill_reference_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT plan_skill_reference_version_fk FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE RESTRICT,
  CONSTRAINT plan_skill_reference_revision_fk FOREIGN KEY (revision_id) REFERENCES skill_entry_revisions(id) ON DELETE RESTRICT
);
