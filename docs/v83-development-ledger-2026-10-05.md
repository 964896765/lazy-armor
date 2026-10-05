# V8.3 Development Ledger — 2026-10-05

Baseline: integration/2026-10-01-cleanup / 476bbb6, with all existing V8.1/V8.2 uncommitted implementation and real evidence preserved. User authorized development from the two V8.3 documents in Downloads. No parallel core/resource system.

## V8.3-0
Implemented: docs/current updated to Persistent Plan & Hybrid Capability Runtime and 13 product domains / 19 legacy runtime taxonomy. CI inspected: pull_request + workflow_dispatch already present, MySQL8.4 gates retained. No remote GitHub run claimed.

## V8.3-A — in progress
Implemented: shared RuntimeTarget contract and public runtime_targets header; owned TrustedDevice/Provider Connection/ServiceProvider adapters; operator-pinned MCP connection mapping. Existing backing tables remain authorization truth; credentials/grants are not copied. Idempotent owner-serialized refresh, missing backing fail closed, stale heartbeats, epoch fencing and manifest mismatch barriers.
Migration: append-only 0076 applied business + isolated MySQL8.4 test DB. No historical PlanVersion modification.
Tests: initial registry integration 3 passed; schema full 192 passed; monorepo typecheck 8/8 passed at A baseline. Additional adapter/invocation regressions pending.
Real evidence: no new V8.3 flow claimed yet; existing V8.1/V8.2 evidence retained.

## V8.3-B — in progress
Explicit canonical identity/aliases; 0077 identities and aliases applied; resolver canonical evaluation keeps source keys and frozen historical inputs. Unknown aliases fail closed. Operator MCP binding uses stable server/tool-specific identity with collision rejection.

## V8.3-C — in progress
Immutable Invocation schema and 0078/0079 storage/links. Existing resolved Execution dispatch creates invocation in same transaction as ActionIntent/adapter binding. Worker rechecks target epoch/manifest. No direct execution endpoint. Android acquisition/create, Service booking and MCP read-only integration remain pending.

## Remaining
D/E durable projections + Result Ledger/ACK/Resume; F/G Android/Provider/MCP/Windows; H Cloud Workspace; I controlled capability candidates; J persistent replanning; K product/real Golden Flows. Missing real credentials/objects stay Pending. No V8.3 completion or Production Ready claim.
