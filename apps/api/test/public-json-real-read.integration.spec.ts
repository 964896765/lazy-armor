import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

/** Opt-in public network read, isolated account/DB. Never user mobile or Goal Runtime acceptance. */
describe.skipIf(process.env.PUBLIC_JSON_REAL_READ !== '1').sequential('real public JSON consumer inspection', { timeout: 60000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session;
  beforeAll(async () => {
    ({ app, pool } = await bootP2App('public-json-real-' + randomUUID()));
    owner = await register(app, randomUUID() + '@example.test', 'Isolated public data acceptance');
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  it('uses explicit consent to read public package metadata, retaining its source-only evidence boundary', async () => {
    const added = (await request(app.getHttpServer()).post('/api/connections').set(auth(owner.token))
      .send({ connectorId: 'public_http_json', externalAccountName: 'Public package metadata', credentials: { endpoint: 'https://registry.npmjs.org/typescript/latest' } }).expect(201)).body;
    expect(added.status).toBe('connected');
    await request(app.getHttpServer()).put(`/api/connections/${added.id}/permissions`).set(auth(owner.token))
      .send({ permissions: [{ capability: 'READ_PUBLIC_HTTP_JSON', granted: true }] }).expect(200);
    const result = (await request(app.getHttpServer()).post(`/api/connections/${added.id}/invoke`).set(auth(owner.token))
      .send({ capability: 'READ_PUBLIC_HTTP_JSON', requestId: randomUUID(), input: {} }).expect(201)).body;
    expect(result.verification).toBe('SOURCE_RESPONSE_ONLY'); expect(result.sourceType).toBe('PUBLIC_HTTP_JSON');
    expect(result.value.name).toBe('typescript'); expect(typeof result.value.version).toBe('string'); expect(result.value.version.length).toBeGreaterThan(0);
    const [rows] = await pool.query<any[]>('SELECT (SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths,(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,(SELECT COUNT(*) FROM capability_invocations WHERE user_id=UUID_TO_BIN(?)) invocations', Array(3).fill(owner.userId));
    expect(rows[0]).toMatchObject({ truths: 0, executions: 0, invocations: 0 });
  });
});
