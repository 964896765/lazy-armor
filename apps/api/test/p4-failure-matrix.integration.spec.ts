import type { INestApplication } from '@nestjs/common';
import type { Connector, ConnectorRequest } from '@lazy-armor/connector-sdk';
import { ConnectorError } from '@lazy-armor/connector-sdk';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootP2App, oauthConnect, register, type Session } from './p2-test-helpers';

type MatrixCase = {
  name: string;
  planId: string;
  executionId?: string;
  dispatch: () => Promise<{ detail: any; today: any; records: any }>;
  expected: {
    executionStatus: string;
    errorCode: string;
    eventType: string;
    category: 'attention' | 'exception' | 'summary';
    actionRequired: boolean;
  };
};

class P4FailureFixtureConnector implements Connector {
  constructor(private readonly key: string) {}

  metadata() {
    return {
      key: this.key,
      name: 'P4 Failure Fixture',
      description: 'P4 failure matrix only',
      version: '1.0.0-test',
      providerType: 'email' as const,
      productionStatus: 'BETA' as const,
      authentication: { type: 'none' as const },
      supportsRefresh: false,
      supportsRevoke: false,
      supportsWebhook: false,
      supportsHealthCheck: true,
      sandboxSupport: 'full' as const,
      rateLimitStrategy: 'retry_after' as const,
    };
  }

  capabilities() {
    return [
      { key: 'READ_EMAIL', name: 'Read email', userFacingName: '读取邮件内容', riskLevel: 'R0' as const, operation: 'read' as const, requiredPermission: 'READ_EMAIL', providerAvailability: 'beta' as const },
      { key: 'TEST_EXECUTE_UNSAFE', name: 'Unsafe execute', userFacingName: '执行外部动作', riskLevel: 'R2' as const, operation: 'execute' as const, requiredPermission: 'TEST_EXECUTE_UNSAFE', providerAvailability: 'beta' as const, sideEffectContract: { sideEffect: true, supportsIdempotencyKey: false, supportsOperationLookup: false, retrySafety: 'unsafe' as const } },
    ];
  }

  async validateConnection() {
    return { status: 'healthy' as const, checkedAt: new Date().toISOString() };
  }

  async read(request: ConnectorRequest) {
    const mode = String(request.input.query ?? request.input.folder ?? 'ok');
    switch (mode) {
      case 'timeout':
        throw new ConnectorError('TIMEOUT', 'TIMEOUT', 'Fixture provider timed out', { retryable: true });
      case 'provider_unavailable':
        throw new ConnectorError('PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'Fixture provider unavailable', { retryable: true });
      case 'provider_5xx':
        throw new ConnectorError('PROVIDER_5XX', 'PROVIDER_UNAVAILABLE', 'Fixture provider returned HTTP 500', { retryable: true });
      case 'rate_limit':
        throw new ConnectorError('RATE_LIMITED', 'RATE_LIMITED', 'Fixture provider rate limited', { retryable: true, retryAfterMs: 1000 });
      case 'network':
        throw new ConnectorError('NETWORK_ERROR', 'PROVIDER_UNAVAILABLE', 'socket hang up', { retryable: true });
      case 'plan_failed':
        throw new ConnectorError('PLAN_FAILED', 'INVALID_REQUEST', 'Fixture plan failed');
      case 'internal':
        throw new Error('TypeError: SQLSTATE[42000] access_token=abc refresh_token=xyz requestId=raw-123');
      default:
        return { ok: true, data: { messages: [] } };
    }
  }

  async execute(request: ConnectorRequest) {
    const recordType = typeof (request.input.config as { recordType?: unknown } | undefined)?.recordType === 'string'
      ? (request.input.config as { recordType: string }).recordType
      : null;
    if (request.capability === 'TEST_EXECUTE_UNSAFE' && recordType === 'outcome_unknown') {
      throw new ConnectorError('TIMEOUT', 'TIMEOUT', 'request sent but access_token=unsafe-provider refresh_token=unsafe-secret', { retryable: true });
    }
    return { ok: true, data: { done: true } };
  }
}

class P4DisabledCalendarConnector implements Connector {
  constructor(private readonly key: string) {}

  metadata() {
    return {
      key: this.key,
      name: 'P4 Disabled Calendar',
      description: 'P4 disabled provider gate only',
      version: '1.0.0-test',
      providerType: 'calendar' as const,
      productionStatus: 'DISABLED' as const,
      authentication: { type: 'none' as const },
      supportsRefresh: false,
      supportsRevoke: false,
      supportsWebhook: false,
      supportsHealthCheck: true,
      sandboxSupport: 'full' as const,
      rateLimitStrategy: 'unknown' as const,
    };
  }

  capabilities() {
    return [
      { key: 'READ_EVENT', name: 'Read event', userFacingName: '读取日历事件', riskLevel: 'R0' as const, operation: 'read' as const, requiredPermission: 'READ_EVENT', providerAvailability: 'disabled' as const },
    ];
  }

  async validateConnection() {
    return { status: 'healthy' as const, checkedAt: new Date().toISOString() };
  }
}

describe.sequential('P4 failure matrix backend closure', { timeout: 120000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(executionId: string): Promise<unknown> };
  let outboxWorker: { poll(): Promise<{ claimed: number; processed: number }> };
  let user: Session;
  let fixtureConnectionId: string;
  let disabledCalendarConnectionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fixtureConnectorKey = `p4-failure-fixture-${unique}`.slice(0, 80);
  const disabledCalendarConnectorKey = `p4-disabled-calendar-${unique}`.slice(0, 80);

  beforeAll(async () => {
    const booted = await bootP2App(`p4-failure-${unique}`);
    app = booted.app;
    pool = booted.pool;
    worker = booted.worker;
    outboxWorker = app.get('OUTBOX_WORKER');
    user = await register(app, `p4-failure-${unique}@example.com`, 'P4 Failure Matrix');

    const registry = app.get<{ register(value: Connector): void }>('CONNECTOR_REGISTRY');
    registry.register(new P4FailureFixtureConnector(fixtureConnectorKey));
    registry.register(new P4DisabledCalendarConnector(disabledCalendarConnectorKey));

    await seedConnector(fixtureConnectorKey, 'P4 Failure Fixture', 'email', 'BETA', [
      { key: 'READ_EMAIL', name: 'Read email', operation: 'read', riskLevel: 'R0', requiredPermission: 'READ_EMAIL', providerAvailability: 'beta', sideEffect: 0, supportsIdempotencyKey: 0, supportsOperationLookup: 0, retrySafety: 'ambiguous' },
      { key: 'TEST_EXECUTE_UNSAFE', name: 'Unsafe execute', operation: 'execute', riskLevel: 'R2', requiredPermission: 'TEST_EXECUTE_UNSAFE', providerAvailability: 'beta', sideEffect: 1, supportsIdempotencyKey: 0, supportsOperationLookup: 0, retrySafety: 'unsafe' },
    ]);
    await seedConnector(disabledCalendarConnectorKey, 'P4 Disabled Calendar', 'calendar', 'DISABLED', [
      { key: 'READ_EVENT', name: 'Read event', operation: 'read', riskLevel: 'R0', requiredPermission: 'READ_EVENT', providerAvailability: 'disabled', sideEffect: 0, supportsIdempotencyKey: 0, supportsOperationLookup: 0, retrySafety: 'ambiguous' },
    ]);

    fixtureConnectionId = await createManualConnection(fixtureConnectorKey, ['READ_EMAIL', 'TEST_EXECUTE_UNSAFE']);
    disabledCalendarConnectionId = await createManualConnection(disabledCalendarConnectorKey, ['READ_EVENT']);
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('covers all 12 failure classes with real backend triggers and preserves consumer-safe projection', async () => {
    const permission = await prepareGmailPlan('Permission Revoked');
    await request(app.getHttpServer())
      .put(`/api/connections/${permission.connectionId}/permissions`)
      .set(auth(user.token))
      .send({ permissions: [{ capability: 'READ_EMAIL', granted: false }] })
      .expect(200);
    await assertMatrixCase({
      name: 'permission revoked',
      planId: permission.planId,
      dispatch: () => dispatchForPlan(permission.planId),
      expected: { executionStatus: 'failed', errorCode: 'PERMISSION_REVOKED', eventType: 'permission_revoked', category: 'attention', actionRequired: true },
    });

    const connectionExpired = await prepareGmailPlan('Connection Expired');
    await pool.query('UPDATE connections SET expires_at=UTC_TIMESTAMP(6) - INTERVAL 5 MINUTE WHERE id=UUID_TO_BIN(?)', [connectionExpired.connectionId]);
    await assertMatrixCase({
      name: 'connection expired',
      planId: connectionExpired.planId,
      dispatch: () => dispatchForPlan(connectionExpired.planId),
      expected: { executionStatus: 'failed', errorCode: 'CONNECTION_EXPIRED', eventType: 'connection_reconnect_required', category: 'attention', actionRequired: true },
    });

    const credentialInvalid = await prepareGmailPlan('Credential Invalid');
    await pool.query(
      `UPDATE credential_refs
         SET status='revoked', updated_at=UTC_TIMESTAMP(6)
       WHERE id=(SELECT credential_ref_id FROM connections WHERE id=UUID_TO_BIN(?))`,
      [credentialInvalid.connectionId],
    );
    await assertMatrixCase({
      name: 'credential invalid',
      planId: credentialInvalid.planId,
      dispatch: () => dispatchForPlan(credentialInvalid.planId),
      expected: { executionStatus: 'failed', errorCode: 'CREDENTIAL_INVALID', eventType: 'credential_revoked', category: 'attention', actionRequired: true },
    });

    await assertMatrixCase({
      name: 'provider timeout',
      planId: await createFixtureReadPlan('Timeout Source', { query: 'timeout' }),
      dispatch: async () => dispatchForPlan(await getLatestPlanId('Timeout Source')),
      expected: { executionStatus: 'failed', errorCode: 'TIMEOUT', eventType: 'provider_timeout', category: 'exception', actionRequired: false },
    });

    await assertMatrixCase({
      name: 'provider 5xx/unavailable',
      planId: await createFixtureReadPlan('Provider 5xx', { query: 'provider_5xx' }),
      dispatch: async () => dispatchForPlan(await getLatestPlanId('Provider 5xx')),
      expected: { executionStatus: 'failed', errorCode: 'PROVIDER_5XX', eventType: 'provider_unavailable', category: 'exception', actionRequired: false },
    });

    await assertMatrixCase({
      name: 'rate limit',
      planId: await createFixtureReadPlan('Rate Limit', { query: 'rate_limit' }),
      dispatch: async () => dispatchForPlan(await getLatestPlanId('Rate Limit')),
      expected: { executionStatus: 'failed', errorCode: 'RATE_LIMITED', eventType: 'rate_limited', category: 'exception', actionRequired: false },
    });

    const missingConnection = await prepareFixturePlan('Missing Connection');
    await pool.query("UPDATE connections SET status='error', updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [missingConnection.connectionId]);
    await assertMatrixCase({
      name: 'missing connection',
      planId: missingConnection.planId,
      dispatch: async () => dispatchForPlan(missingConnection.planId),
      expected: { executionStatus: 'failed', errorCode: 'CONNECTION_UNAVAILABLE', eventType: 'missing_connection', category: 'attention', actionRequired: true },
    });

    await assertMatrixCase({
      name: 'configuration incomplete',
      planId: await createManualPlan('Config Incomplete', {
        sources: [{ sourceType: 'calendar', connectionId: disabledCalendarConnectionId, config: {}, sortOrder: 0 }],
      }),
      dispatch: async () => dispatchForPlan(await getLatestPlanId('Config Incomplete')),
      expected: { executionStatus: 'failed', errorCode: 'PROVIDER_GATE_DISABLED', eventType: 'configuration_incomplete', category: 'attention', actionRequired: true },
    });

    await assertMatrixCase({
      name: 'plan failed',
      planId: await createFixtureReadPlan('Plan Failed', { query: 'plan_failed' }),
      dispatch: async () => dispatchForPlan(await getLatestPlanId('Plan Failed')),
      expected: { executionStatus: 'failed', errorCode: 'PLAN_FAILED', eventType: 'plan_failed', category: 'exception', actionRequired: false },
    });

    const outcomeUnknownPlanId = await createManualPlan('Outcome Unknown', {
      sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
      actions: [{
        actionType: 'update_internal_record',
        connectionId: fixtureConnectionId,
        requiredCapability: 'TEST_EXECUTE_UNSAFE',
        config: { recordType: 'outcome_unknown' },
        stepOrder: 0,
      }],
    });
    await assertMatrixCase({
      name: 'outcome_unknown',
      planId: outcomeUnknownPlanId,
      dispatch: async () => dispatchForPlan(outcomeUnknownPlanId, true),
      expected: { executionStatus: 'failed', errorCode: 'OUTCOME_UNKNOWN', eventType: 'side_effect_outcome_unknown', category: 'attention', actionRequired: true },
    });

    await assertMatrixCase({
      name: 'network failure',
      planId: await createFixtureReadPlan('Network Failure', { query: 'network' }),
      dispatch: async () => dispatchForPlan(await getLatestPlanId('Network Failure')),
      expected: { executionStatus: 'failed', errorCode: 'NETWORK_ERROR', eventType: 'network_failure', category: 'exception', actionRequired: false },
    });

    const unknown = await assertMatrixCase({
      name: 'unknown internal error',
      planId: await createFixtureReadPlan('Unknown Internal', { query: 'internal' }),
      dispatch: async () => dispatchForPlan(await getLatestPlanId('Unknown Internal')),
      expected: { executionStatus: 'failed', errorCode: 'INTERNAL_EXECUTION_ERROR', eventType: 'unknown_internal_error', category: 'exception', actionRequired: false },
    });
    expect(JSON.stringify(unknown.detail)).not.toContain('SQLSTATE');
    expect(JSON.stringify(unknown.detail)).not.toContain('access_token');
    expect(JSON.stringify(unknown.detail)).not.toContain('refresh_token');
    expect(JSON.stringify(unknown.today)).not.toContain('SQLSTATE');
    expect(JSON.stringify(unknown.today)).not.toContain('access_token');
  });

  it('deduplicates failure notifications for the same execution across repeated worker delivery', async () => {
    const plan = await prepareFixturePlan('Duplicate Failure Guard');
    await pool.query("UPDATE connections SET status='error', updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)", [plan.connectionId]);
    const planId = plan.planId;
    const created = await request(app.getHttpServer())
      .post(`/api/plans/${planId}/executions`)
      .set(auth(user.token))
      .send({ requestId: `p4-failure-dedupe-${randomUUID()}`, triggerPayload: {} })
      .expect(201);
    await worker.processExecution(created.body.id);
    await worker.processExecution(created.body.id);
    const detail = await request(app.getHttpServer()).get(`/api/executions/${created.body.id}`).set(auth(user.token)).expect(200);
    expect(detail.body.notifications.filter((item: { eventType: string }) => item.eventType === 'missing_connection')).toHaveLength(1);
  });

  async function createManualConnection(connectorId: string, permissions: string[]) {
    const created = await request(app.getHttpServer())
      .post('/api/connections')
      .set(auth(user.token))
      .send({ connectorId, externalAccountName: `${connectorId}-${unique}` })
      .expect(201);
    await request(app.getHttpServer())
      .put(`/api/connections/${created.body.id}/permissions`)
      .set(auth(user.token))
      .send({ permissions: permissions.map((capability) => ({ capability, granted: true })) })
      .expect(200);
    return created.body.id as string;
  }

  async function seedConnector(
    key: string,
    name: string,
    providerType: string,
    productionStatus: string,
    capabilities: Array<{
      key: string;
      name: string;
      operation: string;
      riskLevel: string;
      requiredPermission: string;
      providerAvailability: string;
      sideEffect: number;
      supportsIdempotencyKey: number;
      supportsOperationLookup: number;
      retrySafety: string;
    }>,
  ) {
    const connectorId = randomUUID();
    await pool.query(
      `INSERT INTO connectors (
        id, connector_key, name, description, status, provider_type, production_status,
        authentication_type, supports_refresh, supports_revoke, supports_webhook,
        supports_health_check, sandbox_support, rate_limit_strategy, adapter_version,
        created_at, updated_at
      ) VALUES (
        UUID_TO_BIN(?), ?, ?, 'P4 failure matrix fixture', 'active', ?, ?, 'none', 0, 0, 0, 1, 'full', 'retry_after', '1.0.0-test',
        UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
      )`,
      [connectorId, key, name, providerType, productionStatus],
    );
    for (const capability of capabilities) {
      await pool.query(
        `INSERT INTO connector_capabilities (
          id, connector_id, capability_key, name, operation, risk_level, required_permission,
          provider_availability, side_effect, supports_idempotency_key, supports_operation_lookup,
          retry_safety, created_at
        ) VALUES (
          UUID_TO_BIN(UUID()), UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6)
        )`,
        [
          connectorId,
          capability.key,
          capability.name,
          capability.operation,
          capability.riskLevel,
          capability.requiredPermission,
          capability.providerAvailability,
          capability.sideEffect,
          capability.supportsIdempotencyKey,
          capability.supportsOperationLookup,
          capability.retrySafety,
        ],
      );
    }
  }

  async function createManualPlan(name: string, input: { sources: Array<Record<string, unknown>>; actions?: Array<Record<string, unknown>> }) {
    const created = await request(app.getHttpServer())
      .post('/api/plans')
      .set(auth(user.token))
      .send({
        name,
        description: 'P4 failure matrix plan',
        domain: 'general',
        automationLevel: 'L2',
        sources: input.sources,
        triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
        conditions: [],
        actions: input.actions ?? [{ actionType: 'compare', config: {}, stepOrder: 0 }],
      })
      .expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${created.body.id}/status`).set(auth(user.token)).send({ status: 'ready' }).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${created.body.id}/versions/1/apply`).set(auth(user.token)).expect(201);
    await request(app.getHttpServer()).post(`/api/plans/${created.body.id}/status`).set(auth(user.token)).send({ status: 'active' }).expect(201);
    return created.body.id as string;
  }

  async function createFixtureReadPlan(name: string, config: Record<string, unknown>) {
    const prepared = await prepareFixturePlan(name, config);
    return prepared.planId;
  }

  async function prepareGmailPlan(name: string) {
    const gmail = await oauthConnect(app, user.token, 'gmail', 'gmail-primary');
    const planId = await createManualPlan(name, {
      sources: [{ sourceType: 'email', connectionId: gmail.connection.id, config: {}, sortOrder: 0 }],
    });
    return { planId, connectionId: gmail.connection.id as string };
  }

  async function prepareFixturePlan(name: string, config: Record<string, unknown> = {}) {
    const connectionId = await createManualConnection(fixtureConnectorKey, ['READ_EMAIL']);
    const planId = await createManualPlan(name, {
      sources: [{ sourceType: 'email', connectionId, config, sortOrder: 0 }],
    });
    return { planId, connectionId };
  }

  async function dispatchForPlan(planId: string, useOutbox = false) {
    const created = await request(app.getHttpServer())
      .post(`/api/plans/${planId}/executions`)
      .set(auth(user.token))
      .send({ requestId: `p4-failure-${randomUUID()}`, triggerPayload: {} })
      .expect(201);
    await worker.processExecution(created.body.id);
    if (useOutbox) {
      for (let attempt = 0; attempt < 3; attempt += 1) await outboxWorker.poll();
    }
    const [detail, today, records] = await Promise.all([
      request(app.getHttpServer()).get(`/api/executions/${created.body.id}`).set(auth(user.token)).expect(200),
      request(app.getHttpServer()).get('/api/today').set(auth(user.token)).expect(200),
      request(app.getHttpServer()).get(`/api/plans/${planId}/executions`).set(auth(user.token)).expect(200),
    ]);
    return { detail: detail.body, today: today.body, records: records.body };
  }

  async function getLatestPlanId(name: string) {
    const response = await request(app.getHttpServer()).get('/api/plans').set(auth(user.token)).expect(200);
    const match = response.body.find((item: { name: string }) => item.name === name);
    if (!match) throw new Error(`Plan not found: ${name}`);
    return match.id as string;
  }

  async function assertMatrixCase(input: MatrixCase) {
    const { detail, today, records } = await input.dispatch();
    expect(detail.status, input.name).toBe(input.expected.executionStatus);
    expect(detail.errorCode, input.name).toBe(input.expected.errorCode);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: detail.id,
        status: input.expected.executionStatus,
        errorCode: input.expected.errorCode,
      }),
    ]));
    expect(detail.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: input.expected.eventType,
        actionRequired: input.expected.actionRequired,
      }),
    ]));
    expect(today.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        executionId: detail.id,
        category: input.expected.category,
        actionRequired: input.expected.actionRequired,
      }),
    ]));
    return { detail, today, records };
  }
});
