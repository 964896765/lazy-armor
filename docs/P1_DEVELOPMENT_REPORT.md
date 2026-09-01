# P1 Development Report

## Status

- Conclusion: `P1 DEVELOPMENT COMPLETE`
- Scope: eight Canonical Plans, natural language plan creation, template contract hardening, consumer language cleanup, and full regression closure
- Non-goal: this document does not mark the project as `PRODUCTION READY`

## Eight Canonical Plans

1. `P1-1 月度账单汇总`
2. `P1-2 话费异常守护`
3. `P1-3 快递静默管家`
4. `P1-4 家庭补给提醒`
5. `P1-5 视频一稿多发`
6. `P1-6 每日重要事项摘要`
7. `P1-7 考试学习计划`
8. `P1-8 设备耗材提醒`

## Unified Architecture Proof

- All eight plans use the same canonical chain:
  `Source -> Trigger -> Condition -> Action -> Risk -> Approval -> Execution -> Result -> Fallback -> Audit`
- All plans reuse the same `Plan`, `PlanVersion`, `Execution`, `ExecutionStep`, `Notification`, `Audit`, and idempotency/outbox infrastructure
- No domain-specific workflow engine was created for billing, logistics, household, content, summary, study, or device domains
- Domain modules only contribute controlled templates, internal source resolvers, controlled actions, runtime enrichment, and presentation

## Template Contract

- `PlanTemplateManifest` now formally carries:
  `approvalPolicy`, `riskConstraint`, `notificationPolicy`
- Risk truth remains in `ACTION_DEFINITIONS`
- Template contracts can restrict emitted actions and risk ceilings, but cannot lower system safety policy
- Resolver now validates:
  schema, action allowlist, risk ceiling, external side effects, approval floor, notification mode allowlist, declared connectors, and client config injection attempts

## Natural Language Creation

- Current production path is deterministic and controlled:
  `natural language -> intent parser -> canonical template -> controlled config -> plan draft`
- Current implementation does not depend on an online LLM to function
- Future AI provider replacement is limited to intent understanding only
- AI is explicitly not allowed to replace:
  `Risk`, `Approval`, `Execution`, `Connector Permission`, `Audit`

## Mobile User Path

- `+` page now supports both:
  `想偷什么懒` and `懒人计划库`
- Template detail pages support install-before-config with controlled fields
- Plan center and plan detail pages show user-language summaries instead of raw engineering enums
- Connections UI uses unified presenter mapping for capabilities, statuses, and risk hints

## Test Matrix

- Typecheck:
  root, API, Mobile
- P1 suites:
  finance, life, content-summary, study, device, templates, natural-language, template-contract, canonical-plans
- P0 key safety regressions:
  execution, risk, approval, runtime permission, idempotency, transactional outbox, audit
- Result: `PASS`

## Deferred Items

- `P0-H1 Android Production Gate`
- `P0-H2 Credential` final verification
- `P0-H3 Webhook` privacy/retention hardening
- `P0-H4 Worker Operations` fault matrix
- `P2-0 Provider Capability Matrix`
- `P2 Connection Lifecycle`
- Real provider adapters:
  `Email / Gmail`, `Calendar`, then `File / Logistics / Content`

## Known Limits

- P1 content flow stops at draft/prepared state; real publish remains protected behind higher-risk gates and provider readiness
- Natural language creation is controlled and deterministic, not free-form arbitrary plan generation
- Consumer UI is cleaned for normal users, but diagnostics/admin surfaces can still keep engineering values
- Development complete does not mean production hardening is finished
