CREATE TABLE mobile_notification_receipts (
  id BINARY(16) NOT NULL,
  user_id BINARY(16) NOT NULL,
  device_app_connection_id BINARY(16) NOT NULL,
  event_id CHAR(64) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  source_package VARCHAR(255) NOT NULL,
  posted_at DATETIME(6) NOT NULL,
  amount_minor INT NULL,
  status VARCHAR(32) NOT NULL,
  snapshot_json JSON NOT NULL,
  received_at DATETIME(6) NOT NULL,
  verified_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY mobile_notification_receipts_connection_event_uq (device_app_connection_id, event_id),
  KEY mobile_notification_receipts_user_received_idx (user_id, received_at),
  CONSTRAINT mobile_notification_receipts_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT mobile_notification_receipts_connection_id_fk FOREIGN KEY (device_app_connection_id) REFERENCES device_app_connections (id) ON DELETE RESTRICT
);
