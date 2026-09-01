# P2 Provider Capability Matrix

## Status

- Development Scope: `P2-0 Provider Capability Matrix`

- Current Validation Date: `2026-09-02`

- Development Status: implemented and covered by `p2-provider-capability.integration.spec.ts`

- Production Readiness is tracked per provider below and must not be inferred from development completion

## Matrix

| Provider           | Provider Key         | Capability            | Read/Write | Auth     | Webhook | Idempotency | Lookup | Retry Safety | Sandbox | Production Status  |
| ------------------ | -------------------- | --------------------- | ---------- | -------- | ------- | ----------- | ------ | ------------ | ------- | ------------------ |
| Manual             | `manual`             | `MANUAL_INPUT`        | Read       | none     | No      | No          | No     | ambiguous    | full    | `PRODUCTION_READY` |
| Internal           | `internal`           | `READ_INTERNAL`       | Read       | none     | No      | No          | No     | ambiguous    | full    | `PRODUCTION_READY` |
| Internal           | `internal`           | `WRITE_INTERNAL`      | Write      | none     | No      | No          | No     | ambiguous    | full    | `PRODUCTION_READY` |
| Webhook            | `webhook`            | `RECEIVE_WEBHOOK`     | Subscribe  | api\_key | Yes     | No          | No     | ambiguous    | limited | `PRODUCTION_READY` |
| Gmail              | `gmail`              | `READ_EMAIL_METADATA` | Read       | oauth2   | No      | No          | No     | ambiguous    | limited | `BETA`             |
| Gmail              | `gmail`              | `READ_EMAIL`          | Read       | oauth2   | No      | No          | No     | ambiguous    | limited | `BETA`             |
| Gmail              | `gmail`              | `CREATE_DRAFT`        | Write      | oauth2   | No      | No          | No     | ambiguous    | limited | `BETA`             |
| Google Calendar    | `google_calendar`    | `READ_EVENT`          | Read       | oauth2   | No      | No          | No     | ambiguous    | limited | `BETA`             |
| File Provider      | `file_provider`      | `READ_FILE_METADATA`  | Read       | oauth2   | No      | No          | No     | ambiguous    | limited | `DRAFT_ONLY`       |
| File Provider      | `file_provider`      | `READ_FILE`           | Read       | oauth2   | No      | No          | No     | ambiguous    | limited | `DRAFT_ONLY`       |
| Logistics Provider | `logistics_provider` | `READ_TRACKING`       | Read       | api\_key | Yes     | No          | No     | ambiguous    | limited | `DRAFT_ONLY`       |
| Content Provider   | `content_provider`   | `READ_CONTENT`        | Read       | oauth2   | No      | No          | No     | ambiguous    | limited | `DRAFT_ONLY`       |
| Content Provider   | `content_provider`   | `CREATE_DRAFT`        | Write      | oauth2   | No      | No          | No     | ambiguous    | limited | `DRAFT_ONLY`       |
| Content Provider   | `content_provider`   | `PUBLISH_CONTENT`     | Write      | oauth2   | No      | Yes         | Yes    | ambiguous    | limited | `DRAFT_ONLY`       |

## Notes

- Provider metadata is now part of the shared connector contract in `packages/connector-sdk`.

- Catalog sync writes registry metadata into `connectors` and `connector_capabilities`, so DB catalog and runtime registry stay aligned.

- Consumer-safe `GET /connectors` hides engineering-only fields; internal view keeps risk, retry, lookup, and side-effect metadata.

- Gmail `SEND_EMAIL`, Calendar `CREATE_EVENT`, and Calendar `UPDATE_EVENT` are intentionally not marked ready in this phase.

- `PUBLISH_CONTENT` remains `DRAFT_ONLY`; browser automation or unofficial workarounds must not be treated as production readiness.

