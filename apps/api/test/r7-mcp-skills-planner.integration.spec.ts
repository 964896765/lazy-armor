import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentPlannerService } from '../src/ai-adapter/agent-planner.service';
import { McpActionAdapter } from '../src/mcp/mcp-action-adapter.service';
import { McpClientService } from '../src/mcp/mcp-client.service';
import { McpServerRegistryService } from '../src/mcp/mcp-server-registry.service';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

const enabled = process.env.RUN_REAL_DB_INTEGRATION === '1';

async function seedConsumableTruth(pipeline: RealityPipelineService, userId: string, unique: string) {
  const evidenceHash = createHash('sha256').update(`r7-consumable-${unique}`).digest('hex');
  const observation = await pipeline.ingest(userId, {
    sourceMode: 'INTERNAL',
    providerKey: 'r7-test',
    externalEventKey: `consumable-${unique}`,
    parserKey: 'generic.consumable-remaining.v1',
    resourceHint: 'device.consumable',
    payload: { remainingDays: 25, subjectKey: `consumable-${unique}` },
    evidenceHash,
    observedAt: new Date().toISOString(),
  });
  const candidate = observation.candidates[0];
  if (!candidate) throw new Error('No consumable candidate produced');
  return pipeline.confirmCandidate(userId, candidate.id, { verifiedBy: 'user_confirmation', verificationMethod: 'user_confirmation' });
}

describe.skipIf(!enabled).sequential('R7 MCP / Portable Skills / Agent Planner golden journeys', { timeout: 180_000 }, () => {
  let app: INestApplication;
  let pool: Pool;
  let owner: Session;
  let other: Session;
  let planner: AgentPlannerService;
  let reality: RealityPipelineService;
  let mcpClient: McpClientService;
  let registry: McpServerRegistryService;
  let actionAdapter: McpActionAdapter;

  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    ({ app, pool } = await bootP2App(`r7-mcp-skills-planner-${unique}`));
    owner = await register(app, `r7-owner-${unique}@example.com`, 'R7 Owner');
    other = await register(app, `r7-other-${unique}@example.com`, 'R7 Other');
    planner = app.get(AgentPlannerService);
    reality = app.get(RealityPipelineService);
    mcpClient = app.get(McpClientService);
    registry = app.get(McpServerRegistryService);
    actionAdapter = app.get(McpActionAdapter);
  });

  afterAll(async () => { await pool?.end(); await app?.close(); });

  it('golden journey 1: daily summary intent becomes a PERIODIC_SUMMARY plan draft', async () => {
    const result = await planner.plan(owner.userId, '每天帮我总结重要事项');
    expect(result.result).toBe('PLAN_DRAFT');
    expect(result.proposal).toMatchObject({ scenarioKey: 'work.work_summary', strategyKey: 'PERIODIC_SUMMARY' });
    expect(result.proposal!.draftDefinition).not.toBeNull();
  });

  it('golden journey 2: delivery diagnosis produces an ANSWER without executing anything', async () => {
    const result = await planner.plan(owner.userId, '为什么我的快递管家没有工作');
    expect(result.result).toBe('ANSWER');
    expect(result.answer!.explanation).toContain('连接');
    expect(result.proposal).toBeUndefined();
  });

  it('golden journey 3: consumable Truth feeds PREDICTIVE_PREPARE plan draft', async () => {
    const truth = await seedConsumableTruth(reality, owner.userId, unique);
    const result = await planner.plan(owner.userId, '根据我现在的耗材情况建立提醒');
    expect(result.result).toBe('PLAN_DRAFT');
    expect(result.proposal).toMatchObject({ scenarioKey: 'device.consumables', strategyKey: 'PREDICTIVE_PREPARE' });
    expect(result.proposal!.selectedTruthRefs).toContain(truth.id);
  });

  it('golden journey 4: Lazy Armor MCP get_truth reads only the authenticated user\'s Truth', async () => {
    const truth = await seedConsumableTruth(reality, owner.userId, `own-${unique}`);

    const forbiddenTools = ['execute_now', 'approve_execution', 'approve_payment', 'pay', 'transfer', 'delete_resource', 'send_arbitrary_message', 'publish', 'get_credentials', 'get_secret', 'get_token', 'get_raw_password', 'get_raw_cookie', 'get_raw_private_evidence', 'get_raw_screenshot'];
    const tools = await request(app.getHttpServer()).get('/api/mcp/lazy-armor/tools').set(auth(owner.token)).expect(200);
    const toolNames = (tools.body.tools as Array<{ name: string }>).map((tool) => tool.name);
    for (const forbidden of forbiddenTools) expect(toolNames).not.toContain(forbidden);

    const ownerRead = await request(app.getHttpServer()).post('/api/mcp/lazy-armor/call').set(auth(owner.token))
      .send({ toolName: 'get_truth', arguments: { truthId: truth.id } }).expect(201);
    expect(ownerRead.body.result.truth).toMatchObject({ id: truth.id, resourceKey: 'device.consumable' });

    await request(app.getHttpServer()).post('/api/mcp/lazy-armor/call').set(auth(other.token))
      .send({ toolName: 'get_truth', arguments: { truthId: truth.id } }).expect(404);
  });

  it('golden journey 5: external READ fixture -> binding -> evidence -> Truth', async () => {
    await registry.bindTool('ext-fixture-read', 'read_connection_health');
    const { truth } = await mcpClient.readToolToTruth(owner.userId, {
      requestId: `r7-read-${unique}`,
      serverId: 'ext-fixture-read',
      toolName: 'read_connection_health',
      arguments: { subjectKey: `conn-${unique}` },
    }, { parserKey: 'generic.connection-health.v1', resourceHint: 'digital_account.connection', confirm: true });
    expect(truth).toBeTruthy();
    expect(truth!.resourceKey).toBe('digital_account.connection');
  });

  it('golden journey 6 + fail-closed: side-effect MCP tool never runs through the read path or without approval proof', async () => {
    await registry.bindTool('ext-fixture-side-effect', 'external_side_effect');

    await expect(mcpClient.invokeReadTool(owner.userId, {
      requestId: `r7-side-${unique}`,
      serverId: 'ext-fixture-side-effect',
      toolName: 'external_side_effect',
      arguments: { payload: 'hello' },
    })).rejects.toThrow(/side effect; use Plan->Execution/);

    const refused = await actionAdapter.executeSideEffect(owner.userId, {
      serverId: 'ext-fixture-side-effect',
      toolName: 'external_side_effect',
      arguments: { payload: 'hello' },
      requestId: `r7-side-${unique}-2`,
      executionAuthorization: { planId: 'not-a-plan', approvalSnapshotHash: 'not-a-hash', effectiveRiskLevel: 'R3' },
    });
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('approval');
  });
});
