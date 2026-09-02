import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('P4 productization foundation', () => {
  let app: INestApplication;
  let pool: Pool;
  let user: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`p4-foundation-${unique}`);
    app = booted.app;
    pool = booted.pool;
    user = await register(app, `p4-foundation-${unique}@example.com`, 'P4 Foundation');
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('persists notification and automation settings through /me/settings', async () => {
    const updated = await request(app.getHttpServer())
      .patch('/api/me/settings')
      .set(auth(user.token))
      .send({
        notifications: {
          importantExceptionImmediately: true,
          regularSummary: false,
          silentSuccess: true,
          dailySummaryTime: '09:30',
        },
        automationSafety: {
          preferredMode: 'prepare_only',
          requireExtraConfirmationForHighRisk: false,
        },
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      notifications: {
        importantExceptionImmediately: true,
        regularSummary: false,
        silentSuccess: true,
        dailySummaryTime: '09:30',
      },
      automationSafety: {
        preferredMode: 'prepare_only',
        requireExtraConfirmationForHighRisk: false,
      },
    });

    const reloaded = await request(app.getHttpServer())
      .get('/api/me/settings')
      .set(auth(user.token))
      .expect(200);
    expect(reloaded.body.notifications.dailySummaryTime).toBe('09:30');
    expect(reloaded.body.automationSafety.preferredMode).toBe('prepare_only');
  });

  it('returns structured today categories from backend instead of relying on title keywords', async () => {
    await pool.query(
      `INSERT INTO notifications (
        id, user_id, execution_id, execution_step_id, approval_request_id, priority, event_type, title_key, message_key,
        message_params, action_type, dedupe_key, title, body, action_required, status, read_at, archived_at, created_at, updated_at
      ) VALUES
        (UUID_TO_BIN(?), UUID_TO_BIN(?), NULL, NULL, NULL, 'P1', 'approval_required', 'n1', 'n1', NULL, NULL, ?, '需要你确认', '这是一条待确认通知', 1, 'unread', NULL, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
        (UUID_TO_BIN(?), UUID_TO_BIN(?), NULL, NULL, NULL, 'P2', 'daily_important_summary', 'n2', 'n2', NULL, NULL, ?, '每日重点', '今天有 3 件重点事项', 0, 'unread', NULL, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [
        crypto.randomUUID(),
        user.userId,
        `approval-${unique}`,
        crypto.randomUUID(),
        user.userId,
        `summary-${unique}`,
      ],
    );
    const today = await request(app.getHttpServer()).get('/api/today').set(auth(user.token)).expect(200);
    expect(today.body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '需要你确认', category: 'attention' }),
      expect.objectContaining({ title: '每日重点', category: 'summary' }),
    ]));
  });

  it('projects important audit events into consumer-safe security activity', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `p4-foundation-${unique}@example.com`, password: 'correct-horse-battery-staple' })
      .expect(201);
    const activity = await request(app.getHttpServer())
      .get('/api/security-activity')
      .set(auth(user.token))
      .expect(200);
    expect(activity.body.length).toBeGreaterThan(0);
    expect(activity.body[0]).toMatchObject({
      title: expect.any(String),
      summary: expect.any(String),
      createdAt: expect.any(String),
    });
  });
});
