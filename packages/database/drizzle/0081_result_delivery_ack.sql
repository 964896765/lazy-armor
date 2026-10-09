CREATE TABLE runtime_result_deliveries (
 id BINARY(16) PRIMARY KEY,result_id BINARY(16) NOT NULL,attempt INT NOT NULL,delivered_at DATETIME(6) NOT NULL,
 UNIQUE KEY runtime_result_delivery_attempt_uq(result_id,attempt),FOREIGN KEY(result_id) REFERENCES runtime_results(id),CHECK(attempt>0)
);
