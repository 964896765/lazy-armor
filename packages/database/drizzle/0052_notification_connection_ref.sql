ALTER TABLE notifications ADD COLUMN connection_id binary(16);
--> statement-breakpoint
ALTER TABLE notifications ADD CONSTRAINT notifications_connection_fk FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX notifications_user_connection_idx ON notifications (user_id, connection_id);
