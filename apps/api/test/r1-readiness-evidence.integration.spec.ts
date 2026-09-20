import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { ReadinessEvidenceService } from '../src/runtime-catalog/readiness-evidence.service';
import { scenarioByKey } from '@lazy-armor/plan-schema';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

describe.sequential('R1 evidence-backed readiness runtime projection', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let user: Session;
  let pipeline: RealityPipelineService;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    const booted = await bootP2App(`r1-readiness-${unique}`);
    app = booted.app;
    pool = booted.pool;
    user = await register(app, `r1-readiness-${unique}@example.com`, 'Readiness Owner');
    pipeline = app.get(RealityPipelineService);
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  it('projects a fail-closed, user-scoped runtime evidence for a fresh account', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/scenario-coverage-ledger/finance.bill/runtime-evidence')
      .set(auth(user.token)).expect(200);

    expect(response.body.scenarioKey).toBe('finance.bill');
    expect(response.body.ledgerRevision).toBe(1);
    expect(response.body.staticContract).toMatchObject({ scenarioKey: 'finance.bill', definition: { immutableRevision: true } });
    expect(response.body.runtime).toMatchObject({
      scenarioKey: 'finance.bill',
      availableFacts: [],
      observationPipelineAvailable: false,
      executionPipelineAvailable: false,
      providerBlocked: true,
      capabilities: [],
    });
    expect(response.body.runtime.readiness.state).toBe('BLOCKED_PROVIDER');
    expect(response.body.runtime.missingFacts).toContain('bill.bill.state');
  });

  it('counts only current Truth facts without treating Truth as execution proof', async () => {
    const observationId = randomUUID();
    const verifiedCandidateId = randomUUID();
    const pendingCandidateId = randomUUID();
    const subjectKey = `bill-${unique}`;
    const evidenceHash = digest(`evidence-${unique}`);

    await pool.query(
      `INSERT INTO source_observations
        (id,user_id,connection_id,source_mode,provider_key,external_event_key,source_identity,parser_key,resource_hint,payload_hash,evidence_hash,payload_json,status,observed_at,occurred_at,received_at)
       VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),NULL,'INTERNAL','r1-test',?,?,?,?,?,?,CAST(? AS JSON),'NORMALIZED',NOW(6),NULL,NOW(6))`,
      [observationId, user.userId, `event-${unique}`, digest(`identity-${unique}`), 'r1-test.v1', 'Bill', digest('payload'), evidenceHash, JSON.stringify({ subjectKey, value: 'OPEN' })],
    );

    for (const [candidateId, factKey, value] of [[verifiedCandidateId, 'bill.bill.state', 'OPEN'], [pendingCandidateId, 'bill.updated_at', '2026-09-18T00:00:00Z']] as const) {
      await pool.query(
        `INSERT INTO candidate_facts
          (id,user_id,observation_id,resource_type,resource_key,subject_key,fact_key,value_json,value_hash,dedupe_key,confidence,normalizer_key,freshness_policy_key,conflict_policy_key,compatibility_resource_key,status,truth_record_id,decided_at,created_at)
         VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'Bill',?,?,?,CAST(? AS JSON),?,?,100,'r1-test.v1','bill.default','latest_verified_then_observed',NULL,'PENDING',NULL,NULL,NOW(6))`,
        [candidateId, user.userId, observationId, subjectKey, subjectKey, factKey, JSON.stringify({ value }), digest(value), digest(`candidate-${candidateId}`)],
      );
    }

    await pipeline.confirmCandidate(user.userId, verifiedCandidateId);

    const response = await request(app.getHttpServer())
      .get('/api/scenario-coverage-ledger/finance.bill/runtime-evidence')
      .set(auth(user.token)).expect(200);

    expect(response.body.runtime.availableFacts).toContain('bill.bill.state');
    expect(response.body.runtime.availableFacts).not.toContain('bill.updated_at');
    expect(response.body.runtime.observationPipelineAvailable).toBe(true);
    expect(response.body.runtime.executionPipelineAvailable).toBe(false);
    expect(response.body.runtime.missingFacts).not.toContain('bill.bill.state');
    // Provider remains blocked for a fresh account with no connected capability.
    expect(response.body.runtime.providerBlocked).toBe(true);
  });

  it('does not count a Truth version outside the scenario freshness window', async () => {
    const scenario = scenarioByKey('finance.bill');
    if (!scenario) throw new Error('missing scenario');
    const projected = await app.get(ReadinessEvidenceService).project(user.userId, {
      ...scenario, freshnessPolicy: { ...scenario.freshnessPolicy, maximumAgeSeconds: 0 },
    }, []);
    expect(projected.input.availableFacts).not.toContain('bill.bill.state');
  });

  it('requires a live heartbeat and active device before counting an AppRead session', async () => {
    const deviceUser = await register(app, `r1-device-${unique}@example.com`, 'Readiness Device Owner');
    const deviceId = randomUUID();
    const appConnectionId = randomUUID();
    const sessionId = randomUUID();
    const scenario = scenarioByKey('finance.bill');
    if (!scenario) throw new Error('missing scenario');
    const sessionOnlyScenario = { ...scenario, freshnessPolicy: { ...scenario.freshnessPolicy, maximumAgeSeconds: 0 } };
    await pool.query(
      `INSERT INTO trusted_devices
        (id,user_id,device_id,key_id,public_key_spki,public_key_fingerprint,trust_level,status,last_proved_at,created_at,updated_at)
       VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),?,'r1-key','test-public-key',?,'trusted','active',NOW(6),NOW(6),NOW(6))`,
      [deviceId, deviceUser.userId, `r1-device-${unique}`, digest(deviceId)],
    );
    await pool.query(
      `INSERT INTO device_app_connections
        (id,user_id,device_id,trusted_device_id,package_name,display_name,modes_json,trust_level,created_at,updated_at)
       VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),?,UUID_TO_BIN(?),'example.bill','Bill',CAST(? AS JSON),'trusted',NOW(6),NOW(6))`,
      [appConnectionId, deviceUser.userId, `r1-device-${unique}`, deviceId, JSON.stringify(['notification_read'])],
    );
    await pool.query(
      `INSERT INTO app_read_sessions
        (id,user_id,trusted_device_id,device_app_connection_id,target_package,modes_json,status,correlation_id,last_heartbeat_at,expires_at,created_at,updated_at)
       VALUES (UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'example.bill',CAST(? AS JSON),'READING',?,?,?,NOW(6),NOW(6))`,
      [sessionId, deviceUser.userId, deviceId, appConnectionId, JSON.stringify(['NOTIFICATION']), digest(sessionId), new Date(Date.now() - 90_000), new Date(Date.now() + 300_000)],
    );
    const projector = app.get(ReadinessEvidenceService);
    expect((await projector.project(deviceUser.userId, sessionOnlyScenario, [])).input.observationPipelineAvailable).toBe(false);
    await pool.query('UPDATE app_read_sessions SET last_heartbeat_at=? WHERE id=UUID_TO_BIN(?)', [new Date(), sessionId]);
    expect((await projector.project(deviceUser.userId, sessionOnlyScenario, [])).input.observationPipelineAvailable).toBe(true);
    await pool.query("UPDATE trusted_devices SET status='revoked',revoked_at=NOW(6) WHERE id=UUID_TO_BIN(?)", [deviceId]);
    expect((await projector.project(deviceUser.userId, sessionOnlyScenario, [])).input.observationPipelineAvailable).toBe(false);
  });
});
