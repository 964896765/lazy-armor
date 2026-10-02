# Consumer Projection Contract v1

The API remains the authority for scenario readiness. Mobile renders a versioned, user-scoped projection; it must never derive `READY` from a static catalog entry or a platform implementation flag.

## Endpoint

`GET /api/scenario-coverage-ledger/:scenarioKey/runtime-evidence`

The response includes `runtime.product` with:

- `contractVersion: 1`
- `productReadiness`: `IMPLEMENTED` or `NOT_VERIFIED`
- `userReadiness`: `READY`, `NEEDS_CONNECTION`, `NEEDS_PERMISSION`, `NEEDS_DATA`, `DEVICE_OFFLINE`, `SERVICE_UNAVAILABLE`, `NEEDS_CONFIRMATION`, or `RESULT_UNKNOWN`
- `title`, `reason`, `nextAction`, `actionPath`

The shared type and runtime validator live in `@lazy-armor/plan-schema/consumer`. The scenario detail screen rejects a missing, unversioned, or unknown projection instead of guessing a favorable state.

`productReadiness` describes the provider/platform implementation only. `userReadiness` is calculated from the user's grants, current health, device heartbeat, fresh Truth, and runtime evidence. `RESULT_UNKNOWN` remains reserved for reconciliation-backed projections; it must not be inferred from a network error in Mobile.

The immutable Scenario Coverage Ledger continues to describe requirements. It is not a user's live readiness state. No Plan, Truth, Risk, Approval, Execution, Verification, or Audit authority is moved into the client by this contract.

## Verification

- Plan Schema contract tests and API projection tests cover versioning and the platform/user distinction.
- API MySQL integration test checks a fresh account remains fail-closed and receives the versioned projection.
- Mobile typecheck confirms use of the shared contract; runtime response validation handles malformed API data.
