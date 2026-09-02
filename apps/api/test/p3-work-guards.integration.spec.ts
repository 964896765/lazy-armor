import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activatePlan, auth, bootP2App, dispatchPlan, oauthConnect, register, type Session } from './p2-test-helpers';

describe.sequential('P3 work representative plans', () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(executionId: string): Promise<unknown> };
  let user: Session;
  let calendarConnectionId: string;
  let fileConnectionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`p3-work-${unique}`);
    app = booted.app;
    pool = booted.pool;
    worker = booted.worker;
    user = await register(app, `p3-work-${unique}@example.com`, 'P3 Work');
    calendarConnectionId = (await oauthConnect(app, user.token, 'google_calendar', 'calendar-conflict')).connection.id as string;
    const fileConnection = await request(app.getHttpServer()).post('/api/connections').set(auth(user.token)).send({
      connectorId: 'file_provider', externalAccountName: '本地文件选择器',
    }).expect(201);
    fileConnectionId = fileConnection.body.id as string;
    await request(app.getHttpServer()).put(`/api/connections/${fileConnectionId}/permissions`).set(auth(user.token)).send({
      permissions: [{ capability: 'READ_FILE_METADATA', granted: true }],
    }).expect(200);
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('detects overlapping calendar events through a read-only Calendar capability', async () => {
    const installed = await request(app.getHttpServer()).post('/api/templates/calendar-conflict-guard/install').set(auth(user.token)).send({
      config: { calendarConnectionId, checkTime: '07:30' },
    }).expect(201);
    await activatePlan(app, user.token, installed.body.id);
    const execution = await dispatchPlan(app, worker, user.token, installed.body.id, { referenceDate: '2027-04-06T07:00:00.000Z' });
    expect(execution.body).toMatchObject({ status: 'succeeded', resultSummary: '发现 1 组日历时间冲突，需要你确认。' });
    const summary = execution.body.outputs.find((item: { actionType: string }) => item.actionType === 'summarize');
    expect(summary.output).toMatchObject({ calendarEventCount: 2, conflictCount: 1 });
    expect(summary.output.conflicts[0]).toMatchObject({ firstTitle: '客户方案评审', secondTitle: '项目周会', overlapMinutes: 30 });

    const notifications = await request(app.getHttpServer()).get('/api/notifications?priority=P1').set(auth(user.token)).expect(200);
    expect(notifications.body.some((item: { eventType: string }) => item.eventType === 'calendar_conflict_detected')).toBe(true);
    const [actions] = await pool.query<RowDataPacket[]>(
      `SELECT pa.action_type actionType, pa.required_capability requiredCapability
         FROM plan_actions pa JOIN plan_versions pv ON pv.id=pa.plan_version_id
        WHERE pv.plan_id=UUID_TO_BIN(?) ORDER BY pa.step_order`,
      [installed.body.id],
    );
    expect(actions.map((row) => row.actionType)).toEqual(['summarize', 'notify']);
  });

  it('prepares a file archive manifest from metadata without storing file content or moving the file', async () => {
    const installed = await request(app.getHttpServer()).post('/api/templates/file-archive-preparation/install').set(auth(user.token)).send({
      config: { fileConnectionId, destination: '项目资料' },
    }).expect(201);
    await activatePlan(app, user.token, installed.body.id);
    const fileName = '项目复盘.txt';
    const fileBytes = Buffer.from(`private-work-content-${unique}`);
    const triggerPayload = {
      fileName,
      mimeType: 'text/plain',
      sizeBytes: fileBytes.length,
      contentSha256: createHash('sha256').update(fileBytes).digest('hex'),
    };
    const execution = await dispatchPlan(app, worker, user.token, installed.body.id, triggerPayload);
    expect(execution.body.status).toBe('succeeded');
    expect(execution.body.resultSummary).toContain('原文件未被移动或删除');
    const archive = execution.body.outputs.find((item: { actionType: string }) => item.actionType === 'archive');
    expect(archive.output).toMatchObject({
      archivePrepared: true,
      archiveManifest: { fileName, contentSha256: triggerPayload.contentSha256, destination: '项目资料' },
    });

    const [stored] = await pool.query<RowDataPacket[]>('SELECT trigger_payload_json triggerPayload FROM executions WHERE id=UUID_TO_BIN(?)', [execution.body.id]);
    expect(JSON.stringify(stored[0].triggerPayload)).not.toContain('private-work-content');
    expect(stored[0].triggerPayload).not.toHaveProperty('contentBase64');
    const [operations] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM side_effect_operations WHERE execution_id=UUID_TO_BIN(?)', [execution.body.id]);
    expect(Number(operations[0].count)).toBe(0);
  });
});
