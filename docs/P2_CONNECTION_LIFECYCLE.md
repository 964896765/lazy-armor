# P2 Connection Lifecycle

## Scope

- Development Scope: `P2 Connection Lifecycle`
- Current Validation Date: `2026-09-02`
- Covered by: `p2-connection-lifecycle.integration.spec.ts`, `p2-gmail.integration.spec.ts`, `p2-calendar.integration.spec.ts`

## Internal Status Model

- `pending_authorization`
- `connected`
- `degraded`
- `expired`
- `permission_required`
- `reauthorization_required`
- `provider_error`
- `revoked`

Presenter text must be derived later. API/storage keep stable enums.

## OAuth Flow

`User -> Start Authorization -> Provider Authorization -> Callback -> Credential Provider -> Credential Version -> Connection -> Permission Confirmation -> Connected`

Implemented endpoints:

- `POST /connections/oauth/:provider/start`
- `POST /connections/oauth/:provider/callback`
- `POST /connections/:id/reconnect`
- `POST /connections/:id/validate`
- `POST /connections/:id/invoke`
- `DELETE /connections/:id`

## Security Rules

- OAuth `state` is generated server-side and stored in `oauth_authorization_states`
- `state` expires after 10 minutes
- `state` is single-use and marked with `consumedAt`
- callback binds `userId + providerKey + state + redirectUri`
- PKCE verifier is generated when provider metadata says `supportsPKCE`
- callback does not trust `provider + code` alone
- local revoke is fail-closed even if provider revoke later fails

## Credential Rules

- Runtime always resolves the current credential version, not an install-time token snapshot
- Near-expiry access tokens refresh through the connector adapter
- Refresh success rotates credential version forward-only
- Refresh failure moves the connection to `reauthorization_required`
- Revoked credential versions cannot become current again

## Runtime Permission

- Every provider call re-checks `PermissionsService.assertGranted()`
- Permission revoke takes effect on the next execution without reinstalling the plan
- `provider_error` does not permanently brick a connection; later reads can retry and recover

## Health and Error Contract

Health result contract:

- `healthy`
- `degraded`
- `unhealthy`
- `reauthorization_required`
- `rate_limited`
- `provider_unavailable`

Connector error contract keeps:

- `code`
- `category`
- `retryable`
- `retryAfterMs`
- `providerCode`
- `operationState`

Standard categories:

- `AUTH_REQUIRED`
- `PERMISSION_DENIED`
- `RATE_LIMITED`
- `PROVIDER_UNAVAILABLE`
- `INVALID_REQUEST`
- `NOT_FOUND`
- `CONFLICT`
- `TIMEOUT`
- `OUTCOME_UNKNOWN`

## Current Provider Lifecycle Status

- Gmail: `BETA`
- Google Calendar: `BETA`
- File Provider: `DRAFT_ONLY`
- Logistics Provider: `DRAFT_ONLY`
- Content Provider: `DRAFT_ONLY`

## Deferred Production Gates

- Real provider OAuth client configuration
- Production credential validation with non-test provider accounts
- Mobile OAuth connection UX
- H1/H2/H3/H4 parallel hardening lines
