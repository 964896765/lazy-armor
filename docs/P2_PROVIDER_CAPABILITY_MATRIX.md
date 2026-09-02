# P2 Provider Capability Matrix

状态值只使用 `PRODUCTION_READY`、`BETA`、`DRAFT_ONLY`、`DISABLED`。

| Provider | Status | OAuth/refresh | webhook | sandbox/rate limit | Capability | Risk | Availability | Side-effect contract |
|---|---|---|---|---|---|---|---|---|
| Gmail | BETA | OAuth2/yes | no | limited/retry_after | READ_EMAIL_METADATA, READ_EMAIL | R0 | BETA | read-only |
| Gmail | BETA | OAuth2/yes | no | limited/retry_after | CREATE_DRAFT | R2 | BETA | side effect; ambiguous retry; Execution Engine only |
| Google Calendar | BETA | OAuth2/yes | no | limited/retry_after | READ_EVENT | R0 | BETA | read-only |
| Google Calendar | BETA | OAuth2/yes | no | limited/retry_after | CREATE_EVENT, UPDATE_EVENT | R3 | DISABLED | idempotency + lookup declared; Provider Gate OFF |
| File local adapter | BETA | none | no | full/fixed_window | READ_FILE_METADATA, READ_FILE | R0 | BETA | read-only; ≤1 MB |
| Logistics test adapter | DRAFT_ONLY | API key contract | yes contract | limited/unknown | READ_TRACKING | R0 | DRAFT_ONLY | test fixtures only; real Provider OFF |
| Content | DRAFT_ONLY | OAuth2/yes | no | limited/unknown | READ_CONTENT | R0 | DRAFT_ONLY | read-only |
| Content | DRAFT_ONLY | OAuth2/yes | no | limited/unknown | CREATE_DRAFT | R2 | DRAFT_ONLY | side effect; ambiguous retry; Execution Engine only |
| Content | DRAFT_ONLY | OAuth2/yes | no | limited/unknown | PUBLISH_CONTENT | R3 | DISABLED | idempotency + lookup declared; Provider Gate OFF |
| Content | DRAFT_ONLY | OAuth2/yes | no | limited/unknown | READ_ANALYTICS | R0 | DISABLED | Provider Gate OFF |
| Webhook | BETA | API key | yes | limited/provider_managed | RECEIVE_WEBHOOK | R0 | BETA | H3 incomplete |

内部 `manual`/`internal` 仍在 Registry，但不作为消费者账号展示。完整可机读矩阵由受保护的 `GET /admin/diagnostics/connectors` 提供；匿名 `GET /connectors` 只返回 consumer-safe DTO。

