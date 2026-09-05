import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';

type MysqlTarget = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

type CanonicalIds = {
  userId: string;
  profileId: string;
  connectorId: string;
  capabilityId: string;
  credentialRefId: string;
  credentialVersionId: string;
  connectionId: string;
  permissionId: string;
  deviceProfileId: string;
  vehicleProfileId: string;
  digitalAccountProfileId: string;
  recurringItemProfileId: string;
  planId: string;
  version1Id: string;
  version2Id: string;
  source1Id: string;
  source2Id: string;
  trigger1Id: string;
  trigger2Id: string;
  condition1Id: string;
  condition2Id: string;
  action1Id: string;
  action2Id: string;
  successExecutionId: string;
  failedExecutionId: string;
  successStepId: string;
  failedStepId: string;
  approvalPolicyId: string;
  approvalRequestId: string;
  approvalDecisionId: string;
  sideEffectOperationId: string;
  outboxMessageId: string;
  auditSuccessId: string;
  auditFailureId: string;
  membershipFreePlanId: string;
  membershipPlusPlanId: string;
  userMembershipId: string;
  usageEventId: string;
  subscriptionCustomerId: string;
  subscriptionId: string;
  subscriptionEventId: string;
  subscriptionCancellationRequestId: string;
  templateLifecycleId: string;
  costBudgetId: string;
};

const DEFAULT_DATABASE_URL = 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor';
const DEFAULT_ADMIN_URL = 'mysql://root:local_root_only@127.0.0.1:3307/mysql';
const BACKUP_DB = process.env.BACKUP_TEST_DB ?? 'lazy_armor_backup_test';
const RESTORE_DB = process.env.RESTORE_TEST_DB ?? 'lazy_armor_restore_test';
const MYSQL_CONTAINER = process.env.MYSQL_DOCKER_CONTAINER ?? 'lazy-armor-p0-mysql-1';

async function main() {
  ensureIsolatedDatabaseName(BACKUP_DB);
  ensureIsolatedDatabaseName(RESTORE_DB);

  const repoRoot = path.resolve(__dirname, '../../..');
  const artifactDir = path.join(repoRoot, 'artifacts', 'backup-restore');
  const dumpPath = path.join(artifactDir, `${BACKUP_DB}.sql`);
  const reportPath = path.join(artifactDir, 'backup-restore-report.json');

  fs.mkdirSync(artifactDir, { recursive: true });

  const baseDatabaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const adminDatabaseUrl = process.env.MYSQL_ADMIN_URL ?? DEFAULT_ADMIN_URL;
  const backupDatabaseUrl = replaceDatabaseName(baseDatabaseUrl, BACKUP_DB);
  const restoreDatabaseUrl = replaceDatabaseName(baseDatabaseUrl, RESTORE_DB);

  const appTarget = parseMysqlUrl(baseDatabaseUrl);
  const adminTarget = parseMysqlUrl(adminDatabaseUrl);
  await recreateDatabase(adminTarget, appTarget, BACKUP_DB);
  await recreateDatabase(adminTarget, appTarget, RESTORE_DB);

  runCommand('pnpm', ['--filter', '@lazy-armor/database', 'migrate'], repoRoot, {
    ...process.env,
    DATABASE_URL: backupDatabaseUrl,
  });

  const ids = await seedCanonicalDataset(backupDatabaseUrl);
  dumpDatabase(parseMysqlUrl(adminDatabaseUrl), BACKUP_DB, dumpPath);
  restoreDatabase(parseMysqlUrl(adminDatabaseUrl), RESTORE_DB, dumpPath);

  const verification = await verifyRestoredData(backupDatabaseUrl, restoreDatabaseUrl);
  const report = {
    generatedAt: new Date().toISOString(),
    backupDatabase: BACKUP_DB,
    restoreDatabase: RESTORE_DB,
    dumpPath,
    dumpBytes: fs.statSync(dumpPath).size,
    verification,
    sampleIds: ids,
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, reportPath, dumpPath, verification }, null, 2));
}

function ensureIsolatedDatabaseName(name: string) {
  if (!/(backup|restore|test)/i.test(name)) {
    throw new Error(`Database "${name}" is not an isolated test database name`);
  }
}

function parseMysqlUrl(databaseUrl: string): MysqlTarget {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname || '127.0.0.1',
    port: Number(url.port || '3306'),
    user: decodeURIComponent(url.username || 'root'),
    password: decodeURIComponent(url.password || ''),
    database: url.pathname.replace(/^\//, '') || 'mysql',
  };
}

function replaceDatabaseName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function recreateDatabase(adminTarget: MysqlTarget, appTarget: MysqlTarget, databaseName: string) {
  const pool = mysql.createPool({
    host: adminTarget.host,
    port: adminTarget.port,
    user: adminTarget.user,
    password: adminTarget.password,
    database: adminTarget.database,
    connectionLimit: 2,
    timezone: 'Z',
  });
  try {
    await pool.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await pool.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await pool.query(`GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO '${appTarget.user}'@'%'`);
  } finally {
    await pool.end();
  }
}

async function seedCanonicalDataset(databaseUrl: string) {
  const target = parseMysqlUrl(databaseUrl);
  const pool = mysql.createPool({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    connectionLimit: 4,
    timezone: 'Z',
  });
  const now = new Date('2026-09-02T12:00:00.000Z');
  const later = new Date('2026-09-09T12:00:00.000Z');
  const ids: CanonicalIds = {
    userId: randomUUID(),
    profileId: randomUUID(),
    connectorId: randomUUID(),
    capabilityId: randomUUID(),
    credentialRefId: randomUUID(),
    credentialVersionId: randomUUID(),
    connectionId: randomUUID(),
    permissionId: randomUUID(),
    deviceProfileId: randomUUID(),
    vehicleProfileId: randomUUID(),
    digitalAccountProfileId: randomUUID(),
    recurringItemProfileId: randomUUID(),
    planId: randomUUID(),
    version1Id: randomUUID(),
    version2Id: randomUUID(),
    source1Id: randomUUID(),
    source2Id: randomUUID(),
    trigger1Id: randomUUID(),
    trigger2Id: randomUUID(),
    condition1Id: randomUUID(),
    condition2Id: randomUUID(),
    action1Id: randomUUID(),
    action2Id: randomUUID(),
    successExecutionId: randomUUID(),
    failedExecutionId: randomUUID(),
    successStepId: randomUUID(),
    failedStepId: randomUUID(),
    approvalPolicyId: randomUUID(),
    approvalRequestId: randomUUID(),
    approvalDecisionId: randomUUID(),
    sideEffectOperationId: randomUUID(),
    outboxMessageId: randomUUID(),
    auditSuccessId: randomUUID(),
    auditFailureId: randomUUID(),
    membershipFreePlanId: randomUUID(),
    membershipPlusPlanId: randomUUID(),
    userMembershipId: randomUUID(),
    usageEventId: randomUUID(),
    subscriptionCustomerId: randomUUID(),
    subscriptionId: randomUUID(),
    subscriptionEventId: randomUUID(),
    subscriptionCancellationRequestId: randomUUID(),
    templateLifecycleId: randomUUID(),
    costBudgetId: randomUUID(),
  };

  const version1Definition = {
    sources: [{ sourceType: 'manual', sortOrder: 0 }],
    triggers: [{ triggerType: 'manual', sortOrder: 0 }],
    conditions: [{ fieldPath: 'amount', operator: 'GT', comparisonValue: 100, sortOrder: 0 }],
    actions: [{ actionType: 'update_internal_record', stepOrder: 0 }],
  };
  const version2Definition = {
    sources: [{ sourceType: 'manual', sortOrder: 0 }],
    triggers: [{ triggerType: 'manual', sortOrder: 0 }],
    conditions: [{ fieldPath: 'amount', operator: 'GT', comparisonValue: 200, sortOrder: 0 }],
    actions: [{ actionType: 'update_internal_record', requiredCapability: 'SEND_EMAIL', stepOrder: 0 }],
  };
  const version1Hash = sha256(canonicalStringify(version1Definition));
  const version2Hash = sha256(canonicalStringify(version2Definition));
  const successInputFingerprint = sha256('success-input');
  const failedInputFingerprint = sha256('failed-input');
  const approvalContextHash = sha256('approval-context');
  const payload = {
    operationId: ids.sideEffectOperationId,
    executionStepId: ids.failedStepId,
    executionId: ids.failedExecutionId,
    userId: ids.userId,
  };
  const payloadHash = sha256(canonicalStringify(payload));
  const requestSnapshot = {
    context: { amount: 360, channel: 'backup-test' },
    config: { recordType: 'backup-failure' },
  };

  try {
    await pool.query(
      `INSERT INTO users (id, status, role, created_at, updated_at)
       VALUES (UUID_TO_BIN(?), 'active', 'user', ?, ?)`,
      [ids.userId, now, now],
    );
    await pool.query(
      `INSERT INTO profiles (id, user_id, display_name, timezone, locale, preferences_json, created_at, updated_at)
       VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), 'Backup Gate User', 'Asia/Shanghai', 'zh-CN', JSON_OBJECT('tab', 'today'), ?, ?)`,
      [ids.profileId, ids.userId, now, now],
    );
    await pool.query(
      `INSERT INTO connectors (
         id, connector_key, name, description, status, provider_type, production_status, authentication_type,
         supports_refresh, supports_revoke, supports_webhook, supports_health_check, sandbox_support, rate_limit_strategy,
         adapter_version, created_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), 'gmail', 'Gmail', 'Backup restore canonical connector', 'active', 'email', 'BETA', 'oauth2',
         1, 1, 0, 1, 'limited', 'provider_managed', '1.0.0', ?, ?
       )`,
      [ids.connectorId, now, now],
    );
    await pool.query(
      `INSERT INTO connector_capabilities (
         id, connector_id, capability_key, name, operation, risk_level, required_permission, provider_availability,
         side_effect, supports_idempotency_key, supports_operation_lookup, retry_safety, created_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), 'SEND_EMAIL', 'Send Email', 'execute', 'R3', 'SEND_EMAIL', 'beta',
         1, 1, 1, 'safe', ?
       )`,
      [ids.capabilityId, ids.connectorId, now],
    );
    await pool.query(
      `INSERT INTO credential_refs (
         id, credential_ref, provider, status, current_version, rotated_at, expires_at, created_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), 'backup-ref-001', 'local', 'active', 1, ?, ?, ?, ?
       )`,
      [ids.credentialRefId, now, later, now, now],
    );
    await pool.query(
      `INSERT INTO credential_versions (
         id, credential_ref_id, version, provider_ref, status, expires_at, revoked_at, created_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), 1, 'provider-ref-001', 'active', ?, NULL, ?
       )`,
      [ids.credentialVersionId, ids.credentialRefId, later, now],
    );
    await pool.query(
      `INSERT INTO connections (
         id, user_id, connector_id, external_account_name, status, status_reason, last_error_code,
         credential_ref_id, expires_at, last_checked_at, created_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'backup-user@gmail.com', 'connected', NULL, NULL,
         UUID_TO_BIN(?), ?, ?, ?, ?
       )`,
      [ids.connectionId, ids.userId, ids.connectorId, ids.credentialRefId, later, now, now, now],
    );
    await pool.query(
      `INSERT INTO connection_permissions (
         id, connection_id, connector_capability_id, granted, granted_at, expires_at, revoked_at, created_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 1, ?, ?, NULL, ?, ?
       )`,
      [ids.permissionId, ids.connectionId, ids.capabilityId, now, later, now, now],
    );
    await pool.query(
      `INSERT INTO device_profiles (
         id, user_id, type, brand, model, purchased_at, warranty_until, maintenance_interval_days, source_type, metadata_json, created_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), 'air_purifier', 'Blueair', '311', ?, ?, 180, 'manual', JSON_OBJECT('room', 'living'), ?, ?
       )`,
      [ids.deviceProfileId, ids.userId, now, later, now, now],
    );
    await pool.query(
      `INSERT INTO vehicle_profiles (
         \`id\`, \`user_id\`, \`brand\`, \`model\`, \`year\`, \`purchased_at\`, \`mileage_km\`, \`mileage_updated_at\`, \`insurance_expires_at\`,
         \`inspection_due_at\`, \`maintenance_due_at\`, \`maintenance_mileage_km\`, \`tire_installed_at\`, \`battery_installed_at\`,
         \`source_type\`, \`metadata_json\`, \`created_at\`, \`updated_at\`
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       )`,
      [
        ids.vehicleProfileId,
        ids.userId,
        'BYD',
        'Seal',
        2025,
        now,
        12000,
        now,
        later,
        later,
        later,
        15000,
        now,
        now,
        'manual',
        JSON.stringify({ plateTail: 'A1' }),
        now,
        now,
      ],
    );
    await pool.query(
      `INSERT INTO digital_account_profiles (
         id, user_id, service_name, subscription_status, expires_at, connection_status, security_reminder_at,
         backup_status, source_type, metadata_json, created_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), 'Google Workspace', 'active', ?, 'connected', ?, 'healthy', 'manual',
         JSON_OBJECT('workspace', 'primary'), ?, ?
       )`,
      [ids.digitalAccountProfileId, ids.userId, later, later, now, now],
    );
    await pool.query(
      `INSERT INTO recurring_item_profiles (
         id, user_id, domain, category, title, next_due_at, recurrence_days, remind_before_days, status, last_completed_at,
         source_type, metadata_json, created_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), 'finance', 'subscription', 'Cloud Drive', ?, 30, 3, 'scheduled', ?, 'manual',
         JSON_OBJECT('currency', 'CNY'), ?, ?
       )`,
      [ids.recurringItemProfileId, ids.userId, later, now, now, now],
    );
    await pool.query(
      `INSERT INTO plans (id, user_id, status, current_version_id, active_version_id, created_at, updated_at, archived_at)
       VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), 'active', NULL, NULL, ?, ?, NULL)`,
      [ids.planId, ids.userId, now, now],
    );
    await pool.query(
      `INSERT INTO plan_versions (
         id, plan_id, version_number, name, description, domain, automation_level, approval_policy_json, template_key, template_version,
         template_config_json, definition_hash, created_by, created_at
       )
       VALUES
       (
         UUID_TO_BIN(?), UUID_TO_BIN(?), 1, '设备提醒 V1', 'Backup canonical version 1', 'life', 'L1',
         JSON_OBJECT('mode', 'none'), 'device-reminder', '1.0.0', JSON_OBJECT('cadence', 'monthly'), ?, UUID_TO_BIN(?), ?
       ),
       (
         UUID_TO_BIN(?), UUID_TO_BIN(?), 2, '设备提醒 V2', 'Backup canonical version 2', 'life', 'L2',
         JSON_OBJECT('mode', 'approval'), 'device-reminder', '2.0.0', JSON_OBJECT('cadence', 'weekly'), ?, UUID_TO_BIN(?), ?
       )`,
      [ids.version1Id, ids.planId, version1Hash, ids.userId, now, ids.version2Id, ids.planId, version2Hash, ids.userId, now],
    );
    await pool.query(
      `UPDATE plans
          SET current_version_id = UUID_TO_BIN(?), active_version_id = UUID_TO_BIN(?), updated_at = ?
        WHERE id = UUID_TO_BIN(?)`,
      [ids.version2Id, ids.version2Id, now, ids.planId],
    );
    await pool.query(
      `INSERT INTO plan_sources (id, plan_version_id, source_type, connector_id, connection_id, config_json, sort_order, created_at)
       VALUES
       (UUID_TO_BIN(?), UUID_TO_BIN(?), 'manual', NULL, NULL, JSON_OBJECT('kind', 'manual'), 0, ?),
       (UUID_TO_BIN(?), UUID_TO_BIN(?), 'manual', NULL, NULL, JSON_OBJECT('kind', 'manual'), 0, ?)`,
      [ids.source1Id, ids.version1Id, now, ids.source2Id, ids.version2Id, now],
    );
    await pool.query(
      `INSERT INTO plan_triggers (id, plan_version_id, trigger_type, config_json, sort_order, created_at)
       VALUES
       (UUID_TO_BIN(?), UUID_TO_BIN(?), 'manual', JSON_OBJECT('source', 'backup'), 0, ?),
       (UUID_TO_BIN(?), UUID_TO_BIN(?), 'manual', JSON_OBJECT('source', 'backup'), 0, ?)`,
      [ids.trigger1Id, ids.version1Id, now, ids.trigger2Id, ids.version2Id, now],
    );
    await pool.query(
      `INSERT INTO plan_conditions (id, plan_version_id, group_id, logical_operator, field_path, operator, comparison_value_json, sort_order, created_at)
       VALUES
       (UUID_TO_BIN(?), UUID_TO_BIN(?), 'root', 'AND', 'amount', 'GT', ?, 0, ?),
       (UUID_TO_BIN(?), UUID_TO_BIN(?), 'root', 'AND', 'amount', 'GT', ?, 0, ?)`,
      [ids.condition1Id, ids.version1Id, JSON.stringify(100), now, ids.condition2Id, ids.version2Id, JSON.stringify(200), now],
    );
    await pool.query(
      `INSERT INTO plan_actions (
         id, plan_version_id, action_type, connector_id, connection_id, required_capability, risk_level, config_json, step_order, created_at
       )
       VALUES
       (
         UUID_TO_BIN(?), UUID_TO_BIN(?), 'update_internal_record', NULL, NULL, NULL, 'R1',
         JSON_OBJECT('recordType', 'backup-success'), 0, ?
       ),
       (
         UUID_TO_BIN(?), UUID_TO_BIN(?), 'update_internal_record', UUID_TO_BIN(?), UUID_TO_BIN(?), 'SEND_EMAIL', 'R3',
         JSON_OBJECT('recordType', 'backup-failure'), 0, ?
       )`,
      [ids.action1Id, ids.version1Id, now, ids.action2Id, ids.version2Id, ids.connectorId, ids.connectionId, now],
    );
    await pool.query(
      `INSERT INTO approval_policies (
         id, user_id, plan_version_id, policy_type, config_json, status, created_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'per_execution', JSON_OBJECT('required', true), 'active', ?, ?
       )`,
      [ids.approvalPolicyId, ids.userId, ids.version2Id, now, now],
    );
    await pool.query(
      `INSERT INTO executions (
         id, user_id, plan_id, plan_version_id, definition_hash, request_id, retry_of_execution_id, trigger_type, trigger_payload_json, status,
         declared_risk_level, approval_status, execution_policy_version, resolved_retry_policy_json, resolved_fallback_policy_json,
         risk_policy_version, resolved_risk_snapshot_json, resolved_approval_policy_json, result_code, result_summary, error_code, error_message,
         cancellation_requested_at, queued_at, started_at, finished_at, worker_token, heartbeat_at, lease_expires_at, created_at, updated_at
       )
       VALUES
       (
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, 'backup-success-request', NULL, 'manual', ?, 'succeeded',
         'R1', 'not_required', 'p4', ?, ?, 'p4', ?, ?,
         'EXECUTION_COMPLETED', 'Backup success execution', NULL, NULL, NULL, ?, ?, ?, NULL, NULL, NULL, ?, ?
       ),
       (
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, 'backup-failed-request', NULL, 'manual', ?, 'failed',
         'R3', 'approved', 'p4', ?, ?, 'p4', ?, ?,
         'OUTCOME_UNKNOWN', 'Backup failed execution', 'OUTCOME_UNKNOWN', 'Needs manual review', NULL, ?, ?, ?, NULL, NULL, NULL, ?, ?
       )`,
      [
        ids.successExecutionId, ids.userId, ids.planId, ids.version1Id, version1Hash, JSON.stringify({ amount: 150 }), JSON.stringify({ maxAttempts: 3 }), JSON.stringify({ fallback: 'notify' }), JSON.stringify({ level: 'R1' }), JSON.stringify({ mode: 'none' }), now, now, now, now, now,
        ids.failedExecutionId, ids.userId, ids.planId, ids.version2Id, version2Hash, JSON.stringify({ amount: 360 }), JSON.stringify({ maxAttempts: 5 }), JSON.stringify({ fallback: 'manual' }), JSON.stringify({ level: 'R3' }), JSON.stringify({ mode: 'approval' }), now, now, now, now, now,
      ],
    );
    await pool.query(
      `INSERT INTO execution_steps (
         id, execution_id, plan_action_id, step_order, action_type, connector_id, connection_id, required_capability,
         declared_risk_level, effective_risk_level, risk_snapshot_json, input_fingerprint, approval_gate_status, dispatch_status, status,
         attempt_count, retry_count, input_snapshot_json, output_snapshot_json, next_retry_at, started_at, finished_at,
         error_code, error_message, fallback_result_json, created_at, updated_at
       )
       VALUES
       (
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 0, 'update_internal_record', NULL, NULL, NULL,
         'R1', 'R1', ?, ?, 'not_required', NULL, 'succeeded',
         1, 0, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?
       ),
       (
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 0, 'update_internal_record', UUID_TO_BIN(?), UUID_TO_BIN(?), 'SEND_EMAIL',
         'R3', 'R3', ?, ?, 'approved', 'outcome_unknown', 'failed',
         2, 1, ?, NULL, NULL, ?, ?, 'OUTCOME_UNKNOWN', 'Needs manual review', ?, ?, ?
       )`,
      [
        ids.successStepId, ids.successExecutionId, ids.action1Id, JSON.stringify({ declared: 'R1' }), successInputFingerprint, JSON.stringify({ amount: 150 }), JSON.stringify({ done: true }), now, now, now, now,
        ids.failedStepId, ids.failedExecutionId, ids.action2Id, ids.connectorId, ids.connectionId, JSON.stringify({ declared: 'R3' }), failedInputFingerprint, JSON.stringify({ amount: 360 }), now, now, JSON.stringify({ action: 'manual_review' }), now, now,
      ],
    );
    await pool.query(
      `INSERT INTO approval_requests (
         id, user_id, execution_id, execution_step_id, plan_id, plan_version_id, plan_action_id, action_type, policy_snapshot,
         reason, requested_at, input_fingerprint, context_hash, effective_risk_level, amount_minor, currency, action_summary,
         status, expires_at, decided_at, decision, decision_reason, created_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'update_internal_record',
         ?, 'Needs approval', ?, ?, ?, 'R3', 3600, 'CNY', 'Send backup failure email',
         'approved', ?, ?, 'approved', 'Allowed for backup restore dataset', ?, ?
       )`,
      [ids.approvalRequestId, ids.userId, ids.failedExecutionId, ids.failedStepId, ids.planId, ids.version2Id, ids.action2Id, JSON.stringify({ mode: 'approval' }), now, failedInputFingerprint, approvalContextHash, later, now, now, now, now],
    );
    await pool.query(
      `INSERT INTO approval_decisions (
         id, approval_request_id, actor_user_id, decision, reason, device_context_json, created_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'approved', 'Backup canonical approval', ?, ?
       )`,
      [ids.approvalDecisionId, ids.approvalRequestId, ids.userId, JSON.stringify({ device: 'backup-test' }), now],
    );
    await pool.query(
      `INSERT INTO side_effect_operations (
         id, user_id, execution_id, execution_step_id, plan_id, plan_version_id, plan_action_id, action_type,
         connector_id, connection_id, capability_key, idempotency_key, input_fingerprint, request_snapshot_json,
         status, provider_operation_id, provider_idempotency_key, attempt_count, result_snapshot_json, result_hash,
         error_code, error_message, correlation_id, causation_id, created_at, started_at, finished_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'update_internal_record',
         UUID_TO_BIN(?), UUID_TO_BIN(?), 'SEND_EMAIL', ?, ?, ?,
         'failed', 'provider-op-001', 'provider-idem-001', 2, NULL, NULL,
         'OUTCOME_UNKNOWN', 'Needs manual review', 'backup-correlation-001', 'approval-request', ?, ?, ?, ?
       )`,
      [ids.sideEffectOperationId, ids.userId, ids.failedExecutionId, ids.failedStepId, ids.planId, ids.version2Id, ids.action2Id, ids.connectorId, ids.connectionId, sha256('backup-idempotency'), failedInputFingerprint, JSON.stringify(requestSnapshot), now, now, now, now],
    );
    await pool.query(
      `INSERT INTO outbox_messages (
         id, aggregate_type, aggregate_id, user_id, event_type, destination, payload_json, payload_hash,
         dedupe_key, correlation_id, causation_id, status, attempt_count, next_attempt_at, locked_by,
         lock_expires_at, last_error_code, last_error_message, created_at, published_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), 'side_effect_operation', UUID_TO_BIN(?), UUID_TO_BIN(?), 'dispatch_side_effect', 'gmail',
         ?, ?, 'outbox:backup:001', 'backup-correlation-001', 'side-effect',
         'dead', 2, ?, NULL, NULL, 'OUTCOME_UNKNOWN', 'Needs manual review', ?, NULL, ?
       )`,
      [ids.outboxMessageId, ids.sideEffectOperationId, ids.userId, JSON.stringify(payload), payloadHash, later, now, now],
    );
    await pool.query(
      `INSERT INTO audit_logs (
         id, actor_type, actor_user_id, action, resource_type, resource_id, user_id, execution_id, execution_step_id,
         approval_request_id, side_effect_operation_id, outbox_message_id, request_id, correlation_id, causation_id,
         before_snapshot_json, after_snapshot_json, change_summary, source, result, reason_code, created_at
       )
       VALUES
       (
         UUID_TO_BIN(?), 'system', UUID_TO_BIN(?), 'EXECUTION_SUCCEEDED', 'execution', ?, UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?),
         NULL, NULL, NULL, 'backup-success-request', 'backup-correlation-001', 'execution',
         NULL, ?, 'Successful backup execution', 'backup_gate', 'success', NULL, ?
       ),
       (
         UUID_TO_BIN(?), 'outbox_worker', NULL, 'SIDE_EFFECT_OUTCOME_UNKNOWN', 'side_effect_operation', ?, UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?),
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'backup-failed-request', 'backup-correlation-001', 'side-effect',
         NULL, ?, 'Outcome unknown after provider timeout', 'backup_gate', 'unknown', 'OUTCOME_UNKNOWN', ?
       )`,
      [
        ids.auditSuccessId, ids.userId, ids.successExecutionId, ids.userId, ids.successExecutionId, ids.successStepId, JSON.stringify({ status: 'succeeded' }), now,
        ids.auditFailureId, ids.sideEffectOperationId, ids.userId, ids.failedExecutionId, ids.failedStepId, ids.approvalRequestId, ids.sideEffectOperationId, ids.outboxMessageId, JSON.stringify({ status: 'outcome_unknown' }), now,
      ],
    );

    // P5 membership / usage / subscription / template / cost canonical dataset
    // (membership_plans 'free'/'plus' are seeded by migration 0023)
    await pool.query(
      `INSERT INTO user_memberships (
         id, user_id, membership_plan_key, status, started_at, current_period_start, current_period_end,
         cancel_at_period_end, provider, external_subscription_id, created_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), 'plus', 'active', ?, ?, ?, 0, 'sandbox', 'sbx_sub_backup_001', ?, ?
       )`,
      [ids.userMembershipId, ids.userId, now, now, later, now, now],
    );
    await pool.query(
      `INSERT INTO usage_events (
         id, user_id, usage_type, quantity, unit, provider, resource_type, resource_id,
         execution_id, side_effect_operation_id, usage_identity, billable, provider_cost_minor, occurred_at, created_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), 'execution.completed', 1, 'execution', NULL, 'execution', ?,
         UUID_TO_BIN(?), UUID_TO_BIN(?), 'execution.completed:backup-usage-001', 1, 0, ?, ?
       )`,
      [ids.usageEventId, ids.userId, ids.successExecutionId, ids.successExecutionId, ids.sideEffectOperationId, now, now],
    );
    await pool.query(
      `INSERT INTO subscription_customers (
         id, user_id, provider, external_customer_id, status, created_at, updated_at
       )
       VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), 'sandbox', 'sbx_cus_backup_001', 'active', ?, ?)`,
      [ids.subscriptionCustomerId, ids.userId, now, now],
    );
    await pool.query(
      `INSERT INTO subscriptions (
         id, user_id, subscription_customer_id, provider, external_subscription_id, checkout_request_id, external_checkout_id,
         checkout_url, membership_plan_key, status, current_period_start, current_period_end, cancel_at_period_end,
         last_applied_occurred_at, created_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'sandbox', 'sbx_sub_backup_001', 'checkout-backup-001', 'sbx_chk_backup_001',
         'https://sandbox.lazy-armor.invalid/checkout/sbx_chk_backup_001', 'plus', 'active', ?, ?, 0, ?, ?, ?
       )`,
      [ids.subscriptionId, ids.userId, ids.subscriptionCustomerId, now, later, now, now, now],
    );
    await pool.query(
      `INSERT INTO subscription_events (
         id, user_id, subscription_id, provider, external_event_id, event_type, payload_hash, payload_snapshot_json, occurred_at, received_at
       )
       VALUES (
         UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'sandbox', 'evt_backup_001', 'subscription.updated', ?, ?, ?, ?
       )`,
      [ids.subscriptionEventId, ids.userId, ids.subscriptionId, sha256('backup-subscription-event'), JSON.stringify({ status: 'active' }), now, now],
    );
    await pool.query(
      `INSERT INTO subscription_cancellation_requests (
         id, user_id, subscription_id, request_id, provider, status, created_at
       )
       VALUES (UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), 'cancel-backup-001', 'sandbox', 'requested', ?)`,
      [ids.subscriptionCancellationRequestId, ids.userId, ids.subscriptionId, now],
    );
    await pool.query(
      `INSERT INTO template_lifecycle_versions (
         id, template_key, template_version, status, revision, reason, updated_by_user_id,
         submitted_at, published_at, deprecated_at, suspended_at, created_at, updated_at
       )
       VALUES (
         UUID_TO_BIN(?), 'device-consumable-reminder', '1.0.0', 'published', 2, NULL, UUID_TO_BIN(?), NULL, ?, NULL, NULL, ?, ?
       )`,
      [ids.templateLifecycleId, ids.userId, now, now, now],
    );
    await pool.query(
      `INSERT INTO cost_budgets (
         id, budget_key, scope_type, user_id, provider, monthly_limit_minor, currency, status, created_at, updated_at
       )
       VALUES (UUID_TO_BIN(?), 'user:backup-budget', 'user', UUID_TO_BIN(?), NULL, 1000, 'CNY', 'active', ?, ?)`,
      [ids.costBudgetId, ids.userId, now, now],
    );
  } finally {
    await pool.end();
  }

  return ids;
}

function dumpDatabase(adminTarget: MysqlTarget, databaseName: string, dumpPath: string) {
  const local = spawnSync('mysqldump', [
    '--single-transaction',
    '--routines',
    '--triggers',
    '--skip-comments',
    '--hex-blob',
    '--default-character-set=utf8mb4',
    '--host',
    adminTarget.host,
    '--port',
    String(adminTarget.port),
    '--user',
    adminTarget.user,
    `--password=${adminTarget.password}`,
    databaseName,
  ], { encoding: 'utf8' });
  if (local.status === 0) {
    fs.writeFileSync(dumpPath, local.stdout, 'utf8');
    return;
  }
  const docker = spawnSync('docker', [
    'exec',
    MYSQL_CONTAINER,
    'mysqldump',
    '--single-transaction',
    '--routines',
    '--triggers',
    '--skip-comments',
    '--hex-blob',
    '--default-character-set=utf8mb4',
    '-uroot',
    '-plocal_root_only',
    databaseName,
  ], { encoding: 'utf8' });
  if (docker.status !== 0) {
    throw new Error(`mysqldump failed.\nlocal: ${local.stderr}\ndocker: ${docker.stderr}`);
  }
  fs.writeFileSync(dumpPath, docker.stdout, 'utf8');
}

function restoreDatabase(adminTarget: MysqlTarget, databaseName: string, dumpPath: string) {
  const sql = fs.readFileSync(dumpPath, 'utf8');
  const local = spawnSync('mysql', [
    '--default-character-set=utf8mb4',
    '--host',
    adminTarget.host,
    '--port',
    String(adminTarget.port),
    '--user',
    adminTarget.user,
    `--password=${adminTarget.password}`,
    databaseName,
  ], { input: sql, encoding: 'utf8' });
  if (local.status === 0) return;
  const docker = spawnSync('docker', [
    'exec',
    '-i',
    MYSQL_CONTAINER,
    'mysql',
    '--default-character-set=utf8mb4',
    '-uroot',
    '-plocal_root_only',
    databaseName,
  ], { input: sql, encoding: 'utf8' });
  if (docker.status !== 0) {
    throw new Error(`mysql restore failed.\nlocal: ${local.stderr}\ndocker: ${docker.stderr}`);
  }
}

async function verifyRestoredData(sourceUrl: string, restoredUrl: string) {
  const source = await createPool(sourceUrl);
  const restored = await createPool(restoredUrl);
  try {
    const counts = await compareTableCounts(source, restored);
    const planVersions = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, BIN_TO_UUID(plan_id) planId, version_number versionNumber, name, definition_hash definitionHash
        FROM plan_versions
       ORDER BY version_number
    `, 'plan_versions');
    const planDefinitions = await compareQuery(source, restored, `
      SELECT 'source' kind, BIN_TO_UUID(plan_version_id) planVersionId, source_type sourceType, sort_order sortOrder, JSON_EXTRACT(config_json, '$') configJson
        FROM plan_sources
      UNION ALL
      SELECT 'trigger' kind, BIN_TO_UUID(plan_version_id) planVersionId, trigger_type sourceType, sort_order sortOrder, JSON_EXTRACT(config_json, '$') configJson
        FROM plan_triggers
      UNION ALL
      SELECT 'condition' kind, BIN_TO_UUID(plan_version_id) planVersionId, operator sourceType, sort_order sortOrder, JSON_EXTRACT(comparison_value_json, '$') configJson
        FROM plan_conditions
      UNION ALL
      SELECT 'action' kind, BIN_TO_UUID(plan_version_id) planVersionId, action_type sourceType, step_order sortOrder, JSON_EXTRACT(config_json, '$') configJson
        FROM plan_actions
       ORDER BY planVersionId, kind, sortOrder
    `, 'plan_definition_rows');
    const executions = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, BIN_TO_UUID(plan_id) planId, BIN_TO_UUID(plan_version_id) planVersionId, request_id requestId, status
        FROM executions
       ORDER BY request_id
    `, 'executions');
    const executionSteps = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, BIN_TO_UUID(execution_id) executionId, step_order stepOrder, status, attempt_count attemptCount, input_fingerprint inputFingerprint
        FROM execution_steps
       ORDER BY executionId, stepOrder
    `, 'execution_steps');
    const approvals = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(ar.id) approvalRequestId, BIN_TO_UUID(ar.execution_id) executionId, BIN_TO_UUID(ar.execution_step_id) executionStepId,
             ar.status, ar.decision, BIN_TO_UUID(ad.id) approvalDecisionId, ad.decision decisionRecorded
        FROM approval_requests ar
        LEFT JOIN approval_decisions ad ON ad.approval_request_id = ar.id
       ORDER BY approvalRequestId
    `, 'approvals');
    const sideEffects = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, BIN_TO_UUID(execution_id) executionId, BIN_TO_UUID(execution_step_id) executionStepId,
             idempotency_key idempotencyKey, provider_operation_id providerOperationId, provider_idempotency_key providerIdempotencyKey, status
        FROM side_effect_operations
       ORDER BY id
    `, 'side_effect_operations');
    const outbox = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, BIN_TO_UUID(aggregate_id) aggregateId, dedupe_key dedupeKey, status, correlation_id correlationId
        FROM outbox_messages
       ORDER BY id
    `, 'outbox_messages');
    const audit = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, action, resource_type resourceType, resource_id resourceId, correlation_id correlationId
        FROM audit_logs
       ORDER BY created_at, id
    `, 'audit_logs');
    const membership = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, plan_key planKey, name, status, version
        FROM membership_plans
       ORDER BY plan_key
    `, 'membership_plans');
    const userMembership = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, membership_plan_key membershipPlanKey, status, provider, external_subscription_id externalSubscriptionId, cancel_at_period_end cancelAtPeriodEnd
        FROM user_memberships
       ORDER BY id
    `, 'user_memberships');
    const usage = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, usage_type usageType, quantity, usage_identity usageIdentity, billable, provider_cost_minor providerCostMinor
        FROM usage_events
       ORDER BY usage_identity
    `, 'usage_events');
    const subscriptionCustomers = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, provider, external_customer_id externalCustomerId, status
        FROM subscription_customers
       ORDER BY external_customer_id
    `, 'subscription_customers');
    const subscriptionsCompare = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, external_subscription_id externalSubscriptionId, external_checkout_id externalCheckoutId, checkout_request_id checkoutRequestId, membership_plan_key membershipPlanKey, status, cancel_at_period_end cancelAtPeriodEnd
        FROM subscriptions
       ORDER BY external_subscription_id
    `, 'subscriptions');
    const subscriptionEventsCompare = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, external_event_id externalEventId, event_type eventType, payload_hash payloadHash
        FROM subscription_events
       ORDER BY external_event_id
    `, 'subscription_events');
    const cancellationRequests = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, request_id requestId, status, provider
        FROM subscription_cancellation_requests
       ORDER BY request_id
    `, 'subscription_cancellation_requests');
    const templateLifecycle = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, template_key templateKey, template_version templateVersion, status, revision
        FROM template_lifecycle_versions
       ORDER BY template_key, template_version
    `, 'template_lifecycle_versions');
    const costBudgetsCompare = await compareQuery(source, restored, `
      SELECT BIN_TO_UUID(id) id, budget_key budgetKey, scope_type scopeType, provider, monthly_limit_minor monthlyLimitMinor, currency, status
        FROM cost_budgets
       ORDER BY budget_key
    `, 'cost_budgets');
    const orphanRows = await countOrphans(restored);
    if (orphanRows !== 0) {
      throw new Error(`Restore verification found orphan rows: ${orphanRows}`);
    }
    return {
      counts,
      orphanRows,
      planVersions: planVersions.length,
      planDefinitionRows: planDefinitions.length,
      executions: executions.length,
      executionSteps: executionSteps.length,
      approvals: approvals.length,
      sideEffects: sideEffects.length,
      outbox: outbox.length,
      audit: audit.length,
      membershipPlans: membership.length,
      userMemberships: userMembership.length,
      usageEvents: usage.length,
      subscriptionCustomers: subscriptionCustomers.length,
      subscriptions: subscriptionsCompare.length,
      subscriptionEvents: subscriptionEventsCompare.length,
      cancellationRequests: cancellationRequests.length,
      templateLifecycleVersions: templateLifecycle.length,
      costBudgets: costBudgetsCompare.length,
    };
  } finally {
    await source.end();
    await restored.end();
  }
}

async function createPool(databaseUrl: string) {
  const target = parseMysqlUrl(databaseUrl);
  return mysql.createPool({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    connectionLimit: 4,
    timezone: 'Z',
  });
}

async function compareTableCounts(source: Pool, restored: Pool) {
  const tables = [
    'users',
    'profiles',
    'connections',
    'connection_permissions',
    'plans',
    'plan_versions',
    'device_profiles',
    'vehicle_profiles',
    'digital_account_profiles',
    'recurring_item_profiles',
    'executions',
    'execution_steps',
    'approval_requests',
    'approval_decisions',
    'side_effect_operations',
    'outbox_messages',
    'audit_logs',
    'membership_plans',
    'user_memberships',
    'usage_events',
    'subscription_customers',
    'subscriptions',
    'subscription_events',
    'subscription_cancellation_requests',
    'template_lifecycle_versions',
    'cost_budgets',
  ];
  const result: Record<string, number> = {};
  for (const table of tables) {
    const sourceCount = await scalar(source, `SELECT COUNT(*) count FROM ${table}`);
    const restoredCount = await scalar(restored, `SELECT COUNT(*) count FROM ${table}`);
    if (sourceCount !== restoredCount) {
      throw new Error(`Count mismatch for ${table}: source=${sourceCount} restored=${restoredCount}`);
    }
    result[table] = restoredCount;
  }
  return result;
}

async function compareQuery(source: Pool, restored: Pool, sql: string, label: string) {
  const [sourceRows] = await source.query<RowDataPacket[]>(sql);
  const [restoredRows] = await restored.query<RowDataPacket[]>(sql);
  const left = JSON.stringify(sourceRows);
  const right = JSON.stringify(restoredRows);
  if (left !== right) {
    throw new Error(`Mismatch in ${label}`);
  }
  return sourceRows;
}

async function countOrphans(pool: Pool) {
  const checks = [
    `SELECT COUNT(*) count FROM profiles p LEFT JOIN users u ON p.user_id = u.id WHERE u.id IS NULL`,
    `SELECT COUNT(*) count FROM connections c LEFT JOIN users u ON c.user_id = u.id LEFT JOIN connectors co ON c.connector_id = co.id WHERE u.id IS NULL OR co.id IS NULL`,
    `SELECT COUNT(*) count FROM connection_permissions cp LEFT JOIN connections c ON cp.connection_id = c.id LEFT JOIN connector_capabilities cc ON cp.connector_capability_id = cc.id WHERE c.id IS NULL OR cc.id IS NULL`,
    `SELECT COUNT(*) count FROM plan_versions pv LEFT JOIN plans p ON pv.plan_id = p.id WHERE p.id IS NULL`,
    `SELECT COUNT(*) count FROM executions e LEFT JOIN plans p ON e.plan_id = p.id LEFT JOIN plan_versions pv ON e.plan_version_id = pv.id LEFT JOIN users u ON e.user_id = u.id WHERE p.id IS NULL OR pv.id IS NULL OR u.id IS NULL`,
    `SELECT COUNT(*) count FROM execution_steps es LEFT JOIN executions e ON es.execution_id = e.id LEFT JOIN plan_actions pa ON es.plan_action_id = pa.id WHERE e.id IS NULL OR pa.id IS NULL`,
    `SELECT COUNT(*) count FROM approval_requests ar LEFT JOIN executions e ON ar.execution_id = e.id LEFT JOIN execution_steps es ON ar.execution_step_id = es.id LEFT JOIN plan_actions pa ON ar.plan_action_id = pa.id WHERE e.id IS NULL OR es.id IS NULL OR pa.id IS NULL`,
    `SELECT COUNT(*) count FROM approval_decisions ad LEFT JOIN approval_requests ar ON ad.approval_request_id = ar.id WHERE ar.id IS NULL`,
    `SELECT COUNT(*) count FROM side_effect_operations so LEFT JOIN executions e ON so.execution_id = e.id LEFT JOIN execution_steps es ON so.execution_step_id = es.id LEFT JOIN plan_actions pa ON so.plan_action_id = pa.id WHERE e.id IS NULL OR es.id IS NULL OR pa.id IS NULL`,
    `SELECT COUNT(*) count FROM outbox_messages om LEFT JOIN users u ON om.user_id = u.id WHERE u.id IS NULL`,
    `SELECT COUNT(*) count FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id LEFT JOIN executions e ON al.execution_id = e.id LEFT JOIN execution_steps es ON al.execution_step_id = es.id LEFT JOIN approval_requests ar ON al.approval_request_id = ar.id LEFT JOIN side_effect_operations so ON al.side_effect_operation_id = so.id LEFT JOIN outbox_messages om ON al.outbox_message_id = om.id WHERE (al.user_id IS NOT NULL AND u.id IS NULL) OR (al.execution_id IS NOT NULL AND e.id IS NULL) OR (al.execution_step_id IS NOT NULL AND es.id IS NULL) OR (al.approval_request_id IS NOT NULL AND ar.id IS NULL) OR (al.side_effect_operation_id IS NOT NULL AND so.id IS NULL) OR (al.outbox_message_id IS NOT NULL AND om.id IS NULL)`,
    `SELECT COUNT(*) count FROM user_memberships um LEFT JOIN users u ON um.user_id = u.id LEFT JOIN membership_plans mp ON um.membership_plan_key = mp.plan_key WHERE u.id IS NULL OR mp.plan_key IS NULL`,
    `SELECT COUNT(*) count FROM usage_events ue LEFT JOIN users u ON ue.user_id = u.id LEFT JOIN executions e ON ue.execution_id = e.id LEFT JOIN side_effect_operations so ON ue.side_effect_operation_id = so.id WHERE u.id IS NULL OR (ue.execution_id IS NOT NULL AND e.id IS NULL) OR (ue.side_effect_operation_id IS NOT NULL AND so.id IS NULL)`,
    `SELECT COUNT(*) count FROM subscription_customers sc LEFT JOIN users u ON sc.user_id = u.id WHERE u.id IS NULL`,
    `SELECT COUNT(*) count FROM subscriptions s LEFT JOIN users u ON s.user_id = u.id LEFT JOIN subscription_customers sc ON s.subscription_customer_id = sc.id LEFT JOIN membership_plans mp ON s.membership_plan_key = mp.plan_key WHERE u.id IS NULL OR sc.id IS NULL OR mp.plan_key IS NULL`,
    `SELECT COUNT(*) count FROM subscription_events se LEFT JOIN users u ON se.user_id = u.id LEFT JOIN subscriptions s ON se.subscription_id = s.id WHERE u.id IS NULL OR s.id IS NULL`,
    `SELECT COUNT(*) count FROM subscription_cancellation_requests scr LEFT JOIN users u ON scr.user_id = u.id LEFT JOIN subscriptions s ON scr.subscription_id = s.id WHERE u.id IS NULL OR s.id IS NULL`,
    `SELECT COUNT(*) count FROM template_lifecycle_versions tlv LEFT JOIN users u ON tlv.updated_by_user_id = u.id WHERE tlv.updated_by_user_id IS NOT NULL AND u.id IS NULL`,
    `SELECT COUNT(*) count FROM cost_budgets cb LEFT JOIN users u ON cb.user_id = u.id WHERE cb.user_id IS NOT NULL AND u.id IS NULL`,
  ];
  let total = 0;
  for (const sql of checks) total += await scalar(pool, sql);
  return total;
}

async function scalar(pool: Pool, sql: string) {
  const [rows] = await pool.query<RowDataPacket[]>(sql);
  return Number(rows[0]?.count ?? 0);
}

function runCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
