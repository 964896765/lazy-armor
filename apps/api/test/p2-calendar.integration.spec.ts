import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { activatePlan, auth, bootP2App, dispatchPlan, oauthConnect, register, type Session } from './p2-test-helpers';

describe.sequential('P2 Calendar connector', () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: { processExecution(executionId: string): Promise<unknown> };
  let user: Session;
  let calendarConnectionId: string;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`calendar-${unique}`);
    app = booted.app;
    pool = booted.pool;
    worker = booted.worker;
    user = await register(app, `p2-calendar-${unique}@example.com`, 'P2 Calendar');
    const connected = await oauthConnect(app, user.token, 'google_calendar', 'calendar-primary');
    calendarConnectionId = connected.connection.id as string;
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('reads normalized calendar events', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/connections/${calendarConnectionId}/invoke`)
      .set(auth(user.token))
      .send({ capability: 'READ_EVENT', requestId: `calendar-read-${unique}`, input: {} })
      .expect(201);
    expect(response.body.events[0]).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      startAt: expect.any(String),
      endAt: expect.any(String),
      timezone: expect.any(String),
      organizer: expect.any(String),
      status: expect.any(String),
    });
  });

  it('syncs calendar events into important_item_candidates', async () => {
    const synced = await request(app.getHttpServer())
      .post('/api/important-item-candidates/sync')
      .set(auth(user.token))
      .send({ connectionId: calendarConnectionId, sourceType: 'calendar' })
      .expect(201);
    expect(synced.body.length).toBeGreaterThan(0);
    const listed = await request(app.getHttpServer())
      .get('/api/important-item-candidates?sourceType=calendar')
      .set(auth(user.token))
      .expect(200);
    expect(listed.body[0].sourceType).toBe('calendar');
  });

  it('feeds real calendar events into the daily summary canonical plan', async () => {
    const installed = await request(app.getHttpServer())
      .post('/api/templates/daily-important-summary/install')
      .set(auth(user.token))
      .send({
        config: {
          planName: `日历重点摘要-${unique}`,
          summaryTime: '07:30',
          includedSources: ['calendar'],
          calendarConnectionId,
          lookAheadHours: 24,
          includeCalendar: true,
          includeMessages: false,
          maxItems: 5,
          notificationPreference: 'summary',
        },
      })
      .expect(201);
    await activatePlan(app, user.token, installed.body.id);
    const execution = await dispatchPlan(app, worker, user.token, installed.body.id, { referenceDate: '2027-04-06T08:00:00.000Z' });
    expect(execution.body.status).toBe('succeeded');
    expect(execution.body.resultSummary).toBe('今天有 2 件重要事项，其中 1 件需要尽快处理。');
    const detail = await request(app.getHttpServer())
      .get(`/api/executions/${execution.body.id}`)
      .set(auth(user.token))
      .expect(200);
    expect(detail.body.outputs.some((item: { actionType: string; output: { sourceCounts?: Record<string, number> } }) => item.actionType === 'summarize' && item.output.sourceCounts?.calendar === 2)).toBe(true);
  });
});
