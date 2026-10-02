# DeviceTask evidence detail closure

The mobile task list now opens a signed, device-scoped detail view. `GET /device-tasks/:id/evidence` reads the existing DeviceTask, SourceObservation, CandidateFact, TruthRecord and (for structured reads) ReadEvidence records. It creates no new facts or execution path.

The projection deliberately omits task payload, raw result, UI nodes, claim token, evidence body and user data values. A pending task with no Observation displays an explicit empty state. A Truth is marked current only when its persisted status is `verified` and it has not been revoked. Mobile can navigate to the existing Truth provenance page.

The API requires the existing TrustedDevice request signature and exact user/device ownership. The R4 MySQL integration suite checks signed access, cross-device denial, verified evidence linkage and redaction. This is code and local database evidence, not Android real-device acceptance.
