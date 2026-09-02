import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

describe.sequential('P2 consumer connector public contract', () => {
  let app: INestApplication;
  let pool: Pool;
  let user: Session;
  let registry: ConnectorRegistry;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`connector-public-${unique}`);
    app = booted.app;
    pool = booted.pool;
    registry = app.get<ConnectorRegistry>('CONNECTOR_REGISTRY');
    user = await register(app, `p2-public-${unique}@example.com`, 'P2 Public Contract');
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  it('never enables an internal view through a public query parameter', async () => {
    const normal = await request(app.getHttpServer()).get('/api/connectors').expect(200);
    const attempted = await request(app.getHttpServer()).get('/api/connectors?view=internal').expect(200);
    const detail = await request(app.getHttpServer()).get('/api/connectors/gmail?view=internal').expect(200);

    expect(attempted.body).toEqual(normal.body);
    for (const response of [normal.body, attempted.body, [detail.body]]) {
      const encoded = JSON.stringify(response);
      expect(encoded).not.toContain('riskLevel');
      expect(encoded).not.toContain('retrySafety');
      expect(encoded).not.toContain('requiredPermission');
      expect(encoded).not.toContain('supportsOperationLookup');
      expect(encoded).not.toContain('sideEffectContract');
      expect(encoded).not.toContain('sideEffect');
    }
  });

  it('requires both authentication and an operations role for internal contracts', async () => {
    await request(app.getHttpServer()).get('/api/admin/diagnostics/connectors').expect(401);
    await request(app.getHttpServer()).get('/api/admin/diagnostics/connectors').set(auth(user.token)).expect(403);
    await pool.query('UPDATE users SET role=? WHERE id=UUID_TO_BIN(?)', ['operations_readonly', user.userId]);
    const response = await request(app.getHttpServer())
      .get('/api/admin/diagnostics/connectors')
      .set(auth(user.token))
      .expect(200);
    expect(JSON.stringify(response.body)).toContain('retrySafety');
    expect(JSON.stringify(response.body)).toContain('sideEffectContract');
  });

  it('keeps registry, database catalog, and public capability keys aligned', async () => {
    const response = await request(app.getHttpServer()).get('/api/connectors').expect(200);
    const registryMatrix = new Map(registry.list().map((connector) => [
      connector.metadata().key,
      connector.capabilities().map((capability) => capability.key).sort(),
    ]));
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT c.connector_key, cc.capability_key FROM connectors c JOIN connector_capabilities cc ON cc.connector_id=c.id ORDER BY c.connector_key, cc.capability_key',
    );
    const databaseMatrix = new Map<string, string[]>();
    for (const row of rows) {
      const values = databaseMatrix.get(row.connector_key as string) ?? [];
      values.push(row.capability_key as string);
      databaseMatrix.set(row.connector_key as string, values);
    }

    for (const provider of response.body as Array<{ key: string; capabilities: Array<{ key: string }> }>) {
      const publicKeys = provider.capabilities.map((capability) => capability.key).sort();
      expect(publicKeys).toEqual(registryMatrix.get(provider.key));
      expect(publicKeys).toEqual(databaseMatrix.get(provider.key));
    }
    const logistics = response.body.find((provider: { key: string }) => provider.key === 'logistics_provider');
    expect(logistics.capabilities.map((capability: { key: string }) => capability.key)).toContain('READ_TRACKING');
    expect(logistics.capabilities.map((capability: { key: string }) => capability.key)).not.toContain('READ_LOGISTICS');
  });
});
