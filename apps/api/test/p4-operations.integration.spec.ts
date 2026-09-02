import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('P4 operations snapshot', { timeout: 60000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let normal: Session;
  let readonly: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`p4-ops-${unique}`);
    app = booted.app;
    pool = booted.pool;
    normal = await register(app, `p4-ops-normal-${unique}@example.com`, 'P4 Ops Normal');
    readonly = await register(app, `p4-ops-readonly-${unique}@example.com`, 'P4 Ops Readonly');
    await pool.query('UPDATE users SET role=? WHERE id=UUID_TO_BIN(?)', ['operations_readonly', readonly.userId]);
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('enforces RBAC and returns operations overview, workers, outbox, executions and connectors without leaking payloads', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/operations/overview')
      .set(auth(normal.token))
      .expect(403);

    const overview = await request(app.getHttpServer())
      .get('/api/admin/operations/overview')
      .set(auth(readonly.token))
      .expect(200);
    expect(overview.body).toMatchObject({
      status: expect.any(String),
      dataStatus: 'available',
      generatedAt: expect.any(String),
      execution: expect.objectContaining({
        active: expect.any(Number),
        failed24h: expect.any(Number),
        waitingApproval: expect.any(Number),
        waitingDispatch: expect.any(Number),
        stuck: expect.any(Number),
      }),
      delivery: expect.objectContaining({
        pendingOutbox: expect.any(Number),
        deadOutbox: expect.any(Number),
        outcomeUnknown: expect.any(Number),
        retryWait: expect.any(Number),
      }),
    });

    const workers = await request(app.getHttpServer())
      .get('/api/admin/operations/workers')
      .set(auth(readonly.token))
      .expect(200);
    expect(workers.body.executionWorker).toMatchObject({
      role: 'execution-worker',
      status: expect.any(String),
      processStatus: expect.any(String),
      dataStatus: 'available',
      processHeartbeatAt: expect.anything(),
      lastWorkActivityAt: expect.anything(),
      readiness: expect.objectContaining({
        status: expect.any(String),
      }),
    });
    expect(workers.body.outboxWorker).toMatchObject({
      role: 'outbox-worker',
      status: expect.any(String),
      processStatus: expect.any(String),
      dataStatus: 'available',
      processHeartbeatAt: expect.anything(),
      lastWorkActivityAt: expect.anything(),
      readiness: expect.objectContaining({
        status: expect.any(String),
      }),
    });

    const outbox = await request(app.getHttpServer())
      .get('/api/admin/operations/outbox')
      .set(auth(readonly.token))
      .expect(200);
    expect(outbox.body).toMatchObject({
      dataStatus: 'available',
      deadCount: expect.any(Number),
      pendingCount: expect.any(Number),
      retryWaitCount: expect.any(Number),
      recentFailures: expect.any(Array),
    });
    expect(JSON.stringify(outbox.body)).not.toContain('payload_json');
    expect(JSON.stringify(outbox.body)).not.toContain('accessToken');

    const executions = await request(app.getHttpServer())
      .get('/api/admin/operations/executions')
      .set(auth(readonly.token))
      .expect(200);
    expect(executions.body).toMatchObject({
      dataStatus: 'available',
      recentFailed: expect.any(Array),
      stuck: expect.any(Array),
    });

    const connectors = await request(app.getHttpServer())
      .get('/api/admin/operations/connectors')
      .set(auth(readonly.token))
      .expect(200);
    expect(connectors.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerKey: expect.any(String),
        productionGateStatus: expect.any(String),
        operationalHealth: expect.any(String),
      }),
    ]));

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT action, COUNT(*) count
         FROM audit_logs
        WHERE user_id=UUID_TO_BIN(?)
          AND action IN (
            'ADMIN_OPERATIONS_OVERVIEW_VIEWED',
            'ADMIN_WORKER_STATUS_VIEWED',
            'ADMIN_OUTBOX_STATUS_VIEWED',
            'ADMIN_EXECUTION_STATUS_VIEWED',
            'ADMIN_CONNECTOR_HEALTH_VIEWED'
          )
        GROUP BY action`,
      [readonly.userId],
    );
    const actions = rows.map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining([
      'ADMIN_OPERATIONS_OVERVIEW_VIEWED',
      'ADMIN_WORKER_STATUS_VIEWED',
      'ADMIN_OUTBOX_STATUS_VIEWED',
      'ADMIN_EXECUTION_STATUS_VIEWED',
      'ADMIN_CONNECTOR_HEALTH_VIEWED',
    ]));
  });
});
