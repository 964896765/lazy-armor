import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { agentReportSchema, reportPlanSchema, type AgentReport } from '@lazy-armor/plan-schema';
import { parseReportModelJson } from '../src/agent/reports/report-model.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';
import { AiProviderConfigService } from '../src/ai-provider-config/ai-provider-config.service';
import { serverDevelopmentAi } from '../src/ai-provider-config/server-development-ai';
import { SkillRepositoriesService } from '../src/portable-skills/skill-repositories.service';
import { AuthoringJobsService } from '../src/orchestrator/authoring-jobs.service';
import { ReportGenerationService } from '../src/agent/reports/report-generation.service';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

describe.skipIf(process.env.V93_METHOD_CHAIN_REAL_ACCEPTANCE !== '1').sequential('real model report method chain in fresh isolated backend', { timeout: 900000 }, () => {
  let app: INestApplication, pool: Pool, owner: Session, other: Session, report: AgentReport | undefined;
  let completed = false;
  const calls: Array<{ purpose: string; methodId?: string; inputHash?: string; requestSha256: string; status?: number; usage?: unknown; diagnostics?: unknown }> = [];
  const evidence = process.env.V93_METHOD_CHAIN_REAL_EVIDENCE, originalFetch = globalThis.fetch;
  const persist = () => {
    if (!evidence) return;
    writeFileSync(evidence, JSON.stringify({ schemaVersion: 'v93-method-chain-real.v1', scope: 'ISOLATED_REAL_MODEL_BACKEND_ONLY', completed,
      databaseName: process.env.TEST_DATABASE_NAME, calls, reportStage: report?.stage, errorCode: report?.errorCode,
      checkedMethods: report?.methodRuns?.length ?? 0, budget: report?.budget, marketFactsVerified: false,
      mobileAcceptance: 'PENDING', runtimeCompilation: 'NOT_COMPILED', updatedAt: new Date().toISOString() }, null, 2));
    if (report) {
      writeFileSync(evidence + '.report.json', JSON.stringify(report, null, 2));
      if (report.markdown) writeFileSync(evidence + '.report.md', report.markdown);
    }
  };
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL ?? 'mysql://invalid/invalid'), redis = new URL(process.env.REDIS_URL ?? 'redis://invalid');
    if (db.hostname !== '127.0.0.1' || db.port !== '3311' || !/^\/lazy_armor_v93_methods_real_\d{8}_[a-f0-9]{8}_test$/.test(db.pathname)
      || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL || db.pathname !== '/' + process.env.TEST_DATABASE_NAME
      || redis.hostname !== '127.0.0.1' || redis.port !== '6391' || redis.pathname !== '/15'
      || !process.env.REDIS_KEY_PREFIX?.startsWith('v93-methods-real:') || process.env.REDIS_KEY_PREFIX !== process.env.TEST_REDIS_KEY_PREFIX)
      throw new Error('Exact fresh isolated target required');
    if (!evidence || [evidence, evidence + '.report.json', evidence + '.report.md'].some(existsSync)) throw new Error('Fresh evidence required');
    const config = serverDevelopmentAi({ ...process.env, NODE_ENV: 'development' });
    if (!config) throw new Error('Existing private development model required');
    ({ app, pool } = await bootP2App('v93-real-' + randomUUID()));
    vi.spyOn(app.get(AiProviderConfigService), 'resolve').mockResolvedValue(config);
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url !== 'https://api.deepseek.com/chat/completions') return originalFetch(input, init);
      const body = JSON.parse(String(init?.body)), data = JSON.parse(body.messages.find((message: { role: string }) => message.role === 'user').content);
      const call = { purpose: 'method' in data ? 'METHOD' : 'availableSources' in data ? 'PLAN' : 'markdown' in data ? 'REVIEW' : 'WRITE',
        ...('method' in data ? { methodId: data.method.ref.entryId, inputHash: sha(JSON.stringify(data.inputs)) } : {}), requestSha256: sha(String(init?.body)), status: undefined as number | undefined, usage: undefined as unknown, diagnostics: undefined as unknown };
      calls.push(call); persist();
      const response = await originalFetch(input, init);
      const provider = await response.clone().json().catch(() => ({})) as { usage?: unknown; choices?: Array<{ message?: { content?: string } }> };
      call.status = response.status; call.usage = provider.usage;
      if (call.purpose === 'PLAN') {
        try {
          const checked = reportPlanSchema.safeParse(parseReportModelJson(provider.choices?.[0]?.message?.content ?? ''));
          call.diagnostics = checked.success ? { contract: 'VALID', missingDeliveries: (data.requirementContext?.composition?.snapshot.selection.graph.deliveries ?? [])
            .filter((delivery: { label: string }) => !checked.data.sections.some(section => section.includes(delivery.label))).map((delivery: { label: string }) => delivery.label) }
            : { contract: 'INVALID', issues: checked.error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code, message: issue.message.slice(0, 160) })) };
        } catch { call.diagnostics = { contract: 'INVALID_JSON' }; }
      }
      persist(); return response;
    };
    owner = await register(app, randomUUID() + '@example.test', '隔离学习验收用户');
    other = await register(app, randomUUID() + '@example.test', '另一隔离用户');
  });
  afterAll(async () => { try { persist(); await app?.close(); await pool?.end(); } finally { globalThis.fetch = originalFetch; vi.restoreAllMocks(); } });

  it('produces actual upstream values, saves checked method results, writes a complete report and replays without paid calls', async () => {
    const ports = (field: string) => ({ type: 'object', additionalProperties: false, properties: { [field]: { type: 'string' } }, required: [field] });
    const methods = app.get(SkillRepositoriesService);
    const imported = await methods.import(owner.userId, { schemaVersion: 'skill-repository.v1', requestId: randomUUID(), name: '隔离学习方法链', sourceType: 'USER', entries: [
      { name: 'LearningResearch', version: '1.0.0', description: '整理用户学习条件与策略', domain: 'learning', input: ports('goal'), output: ports('research'), requiredCapabilities: [], permission: ['READ'], risk: 'R0', verification: ['USER_CONFIRMATION'], instruction: '依据goal将英语口语学习条件整理成五项简短研究摘要：目标、时间、预算、限制、策略。research不超过600字，不撰写完整报告、不提供逐日课程。未提供信息保持未知或明确假设，不编造调查与工具结果。' },
      { name: 'LearningReport', version: '1.0.0', description: '根据前序研究形成报告材料', domain: 'learning', input: ports('research'), output: ports('report'), requiredCapabilities: [], permission: ['READ'], risk: 'R0', verification: ['USER_CONFIRMATION'], instruction: '将research的五项实际研究摘要扩展成新的详细学习报告材料，不能直接复述输入。report包含四周课程安排、每天30分钟的具体练习流程、500元预算分配建议、风险与效果检查，至少1200字。保持条件和假设，不能仅承诺以后写作，不执行外部操作。' },
    ] });
    const repository = await methods.change(owner.userId, imported.id, 1, true);
    const refs = repository.entries.map(entry => ({ repositoryId: repository.id, repositoryVersion: repository.version, entryId: entry.id, revisionId: entry.revisionId, contentHash: entry.contentHash }));
    const research = repository.entries.find(entry => entry.manifest.name === 'LearningResearch')!, drafting = repository.entries.find(entry => entry.manifest.name === 'LearningReport')!;
    const created = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token)).send({ mode: 'TEMPORARY', methodRefs: refs }).expect(201)).body;
    const source = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/messages`).set(auth(owner.token)).send({ content: '生成英语口语学习研究报告：30天、每天30分钟、预算500元；条件为开发验收假设，不是真人背景，学习效果需观察，不使用外部网页。', version: 0, requestId: randomUUID(), authoringMode: 'DURABLE' }).expect(201)).body;
    await app.get(AuthoringJobsService).process(source.authoringJobs.at(-1).jobId);
    const current = (await request(app.getHttpServer()).get(`/api/conversations/${created.id}`).set(auth(owner.token)).expect(200)).body;
    const initial = current.messages.filter((row: { role: string }) => row.role === 'assistant').at(-1);
    await app.get(ReportGenerationService).process(initial.id);
    const initialResult = (await request(app.getHttpServer()).get(`/api/conversations/${created.id}`).set(auth(owner.token)).expect(200)).body;
    report = agentReportSchema.parse(initialResult.messages.find((row: { id: string }) => row.id === initial.id).structuredPayload.report); persist();
    expect(report.stage).toBe('COMPLETED');
    const graph = { version: current.version, goalBindings: [{ methodId: research.id, inputField: 'goal', goalField: 'goal' }], links: [{ fromMethodId: research.id, outputField: 'research', toMethodId: drafting.id, inputField: 'research' }], deliveries: [{ methodId: drafting.id, outputField: 'report', label: '学习研究报告' }] };
    const preview = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/composition-preview`).set(auth(owner.token)).send({ graph }).expect(201)).body;
    expect(preview.state).toBe('STRUCTURE_VALID');
    const selection = { graph, basis: { goalBriefRef: preview.goalBriefRef, methodRefs: preview.methodRefs, sourceMessageRefs: preview.sourceMessageRefs } }, requestId = randomUUID();
    const accepted = (await request(app.getHttpServer()).post(`/api/conversations/${created.id}/composition-authoring`).set(auth(owner.token)).send({ requestId, selection }).expect(201)).body;
    const startCalls = calls.length;
    await app.get(AuthoringJobsService).process(accepted.authoringJobs.at(-1).jobId);
    const queued = (await request(app.getHttpServer()).get(`/api/conversations/${created.id}`).set(auth(owner.token)).expect(200)).body;
    const output = queued.messages.find((row: { role: string; requestId: string }) => row.role === 'assistant' && row.requestId === requestId);
    await app.get(ReportGenerationService).process(output.id);
    const final = (await request(app.getHttpServer()).get(`/api/conversations/${created.id}`).set(auth(owner.token)).expect(200)).body;
    report = agentReportSchema.parse(final.messages.find((row: { id: string }) => row.id === output.id).structuredPayload.report); persist();
    expect(report.stage).toBe('COMPLETED'); expect(report.methodRuns).toHaveLength(2);
    expect(report.methodRuns![0].outputs.research).toBeTypeOf('string');
    expect(report.methodRuns![1].inputs.research).toBe(report.methodRuns![0].outputs.research);
    expect(String(report.methodRuns![0].outputs.research).length).toBeLessThanOrEqual(1000);
    expect(report.methodRuns![1].outputs.report).not.toBe(report.methodRuns![0].outputs.research);
    expect(String(report.methodRuns![1].outputs.report).length).toBeGreaterThan(500);
    expect(report.markdown!.length).toBeGreaterThan(800); expect(report.markdown).toContain('学习研究报告');
    expect(report.budget!.modelCalls).toBe(calls.length - startCalls);
    expect(report.budget!.usageResponses).toBe(report.budget!.modelCalls);
    const beforeReplay = calls.length;
    await request(app.getHttpServer()).post(`/api/conversations/${created.id}/composition-authoring`).set(auth(owner.token)).send({ requestId, selection }).expect(201);
    await app.get(ReportGenerationService).process(output.id);
    expect(calls.length).toBe(beforeReplay);
    await request(app.getHttpServer()).get(`/api/conversations/${created.id}`).set(auth(other.token)).expect(404);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans,(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions,(SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths', [owner.userId, owner.userId, owner.userId]);
    expect(rows[0]).toMatchObject({ plans: 0, executions: 0, truths: 0 });
    completed = true; persist();
  });
});
