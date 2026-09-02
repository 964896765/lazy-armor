# Rollback Procedure

## Scope

This runbook defines the minimum rollback path for P4 and early P5 releases.

- Goal: keep user data safe and restore application availability quickly.

- Allowed rollback targets: API, execution worker, outbox worker, mobile release.

- Not allowed: automatic database downgrade.

Database schema remains forward-only.

## Release Order

Every release follows this fixed order:

1. Precheck
2. Backup
3. Backup Verification
4. Forward Migration
5. API Rollout
6. Execution Worker Rollout
7. Outbox Worker Rollout
8. Health / Readiness Verification
9. Mobile Rollout

Do not change the order during normal release work.

## Precheck

Before rollout:

- Confirm the target commit is built and locally verified.

- Confirm migration files are forward-only.

- Confirm no destructive migration is included.

- Confirm credentials and environment variables point to the intended environment.

- Confirm the previous stable API and worker build artifacts are still available for rollback.

## Backup

Before applying migration:

- Create a database backup with `mysqldump` or an equivalent MySQL-native mechanism.

- Store the backup outside the application working tree.

- Record backup timestamp, source database, operator, and release commit.

## Backup Verification

Before application rollout:

- Restore the backup into an isolated test database.

- Verify key tables and references can be read successfully.

- Verify orphan rows remain `0`.

- Verify `PlanVersion` identity and hashes remain unchanged.

Current local verification command:

```bash
pnpm db:backup-restore-gate
```

Latest local evidence:

- Report: `artifacts/backup-restore/backup-restore-report.json`

- Dump: `artifacts/backup-restore/lazy_armor_backup_test.sql`

## Forward Migration

Apply schema changes only after backup verification passes.

- Migrations must be forward-only.

- Use expand -> migrate -> compatible rollout -> later contract.

- If migration fails, stop rollout and keep the previous application version running.

- Do not attempt automatic database downgrade.

## Application Rollback

If rollout fails after migration but before data corruption:

- Roll back API to the previous stable version.

- Roll back execution worker to the previous stable version.

- Roll back outbox worker to the previous stable version.

- Pause or hold mobile rollout if the issue is server-side.

Rollback is valid only when the older application version remains compatible with the migrated schema.

## Mobile Rollback

Mobile release rollback is application-only:

- Stop staged rollout or remove the bad release from the distribution channel.

- Re-promote the previous verified mobile build if needed.

- Do not use mobile rollback as a database recovery mechanism.

## Hard Stops

Stop rollout and require manual intervention when any of the following is true:

- Data loss risk is detected.

- A destructive migration is required.

- `PlanVersion` identity or hash changes unexpectedly.

- `Execution`, `Approval`, `SideEffectOperation`, `Outbox`, or `Audit` records are missing or corrupted.

- Token, credential, password, or secret leakage is detected.

- Authorization, approval, or risk controls are bypassed.

- Idempotency or outbox atomicity is no longer trustworthy.

## Recovery Notes

If a release is rolled back:

- Keep the migrated database.

- Restore application code only.

- Record the failure reason and the exact rollback timestamp.

- Open a follow-up fix before the next rollout attempt.

## Current P4 Minimum Standard

For the current phase, rollback is considered minimally ready when:

- backup can be created,

- backup can be restored into an isolated test database,

- migration stays forward-only,

- previous stable API and worker versions can be redeployed,

- mobile rollout can be halted or reverted independently.

