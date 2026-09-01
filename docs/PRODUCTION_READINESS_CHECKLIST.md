# Production Readiness Checklist

## Purpose

- This checklist separates `Development Complete` from `Production Ready`
- Current project state: `P1 DEVELOPMENT COMPLETE`
- Current project state is **not yet** `PRODUCTION READY`

## Development Complete

- [x] P0 core architecture completed
- [x] P1-1 to P1-8 Canonical Plans completed
- [x] Natural language plan creation completed with controlled fallback path
- [x] Template contract completed
- [x] Consumer language cleanup completed for primary mobile flows
- [x] P1 full regression completed
- [x] P1 canonical plans regression completed
- [x] P1 documentation updated to current state

## Production Ready

- [ ] Android release signing uses formal production signing instead of debug keystore
- [ ] Production APK / AAB build path is validated end-to-end
- [ ] Mobile secure token storage failure modes are verified fail-closed
- [ ] Credential rotation / current version / revoke contract is verified under concurrency
- [ ] Provider unavailable and restart recovery paths are verified for credential resolution
- [ ] Webhook privacy stripping / retention / duplicate delivery / invalid signature paths are verified
- [ ] Worker crash / restart / Redis / MySQL fault matrix is verified
- [ ] No external side effect can be duplicated after crash or queue redelivery
- [ ] Audit retention remains intact across retries, restart, and recovery paths
- [ ] Real provider OAuth / refresh / revoke lifecycle is validated for the first production connectors
- [ ] Monitoring / metrics / readiness signals are reviewed as production gates

## Hard Rules

- `Development Complete` is allowed to move the project into `P2` feature development
- `Production Ready` requires the hardening checklist above, not just passing feature tests
- No document or release note should collapse these two states into one
