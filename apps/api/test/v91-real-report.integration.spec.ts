import type { INestApplication } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { agentReportSchema, calculateReportFinancial, goalBriefSchema, FINANCIAL_APPENDIX, reportTerminal,
  type AgentReport, type ReportRequirementContext } from '@lazy-armor/plan-schema';
import { AiProviderConfigService } from '../src/ai-provider-config/ai-provider-config.service';
import { serverDevelopmentAi } from '../src/ai-provider-config/server-development-ai';
import { ReportGenerationService } from '../src/agent/reports/report-generation.service';
import { auditedReportFinancial, reportFinancialAudit } from '../src/agent/reports/report-financial-audit';
import { AuthoringJobsService } from '../src/orchestrator/authoring-jobs.service';
import { auth, bootP2App, register, type Session } from './p2-test-helpers';

interface Conversation {
  id: string; version: number; planId: string | null;
  messages: Array<{ id: string; role: string; structuredPayload: Record<string, unknown> }>;
  authoringJobs: Array<{ jobId: string; status: string }>;
}
interface ModelCall {
  purpose: 'PLAN' | 'WRITE' | 'REVIEW' | 'OTHER'; model: string; startedAt: string; finishedAt?: string;
  requestSha256: string; status?: number; usage?: unknown; requirementContext?: ReportRequirementContext;
  goal?: string; financialAudit?: ReturnType<typeof reportFinancialAudit>;
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe.skipIf(process.env.V91_REAL_REPORT_ACCEPTANCE !== '1').sequential(
  'Opt-in V91 real report generation in a fresh isolated backend; not market or mobile acceptance', { timeout: 900_000 }, () => {
    let app: INestApplication, pool: Pool, owner: Session, other: Session;
    let jobs: AuthoringJobsService, reports: ReportGenerationService;
    let latestReport: AgentReport | undefined, completed = false;
    const calls: ModelCall[] = [], stages: string[] = [], originalFetch = globalThis.fetch;
    const startedAt = new Date().toISOString(), evidence = process.env.V91_REAL_REPORT_EVIDENCE;
    const saveEvidence = () => {
      if (!evidence) return;
      writeFileSync(evidence, JSON.stringify({ schemaVersion: 'v91-real-report-acceptance.v1', startedAt, updatedAt: new Date().toISOString(),
        completed, scope: 'ISOLATED_REAL_MODEL_BACKEND_ONLY', databaseName: process.env.TEST_DATABASE_NAME,
        stages, calls, latestReportStage: latestReport?.stage, errorCode: latestReport?.errorCode,
        marketFactsVerified: false, mobileAcceptance: 'PENDING', runtimeAcceptance: 'PENDING' }, null, 2));
      if (latestReport) {
        writeFileSync(evidence + '.report.json', JSON.stringify(latestReport, null, 2));
        if (latestReport.markdown) writeFileSync(evidence + '.report.md', latestReport.markdown);
      }
    };
    beforeAll(async () => {
      const database = new URL(process.env.DATABASE_URL ?? 'mysql://invalid/invalid');
      const redis = new URL(process.env.REDIS_URL ?? 'redis://invalid');
      if (database.hostname !== '127.0.0.1' || database.port !== '3311'
          || !/^\/lazy_armor_v91_real_\d{8}_[a-f0-9]{8}_test$/.test(database.pathname)
          || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL || database.pathname !== '/' + process.env.TEST_DATABASE_NAME
          || redis.hostname !== '127.0.0.1' || redis.port !== '6391' || redis.pathname !== '/15'
          || !process.env.REDIS_KEY_PREFIX?.startsWith('v91-real:') || process.env.REDIS_KEY_PREFIX !== process.env.TEST_REDIS_KEY_PREFIX)
        throw new Error('Fresh exact isolated V91 target required');
      if (!evidence || [evidence, evidence + '.report.json', evidence + '.report.md'].some(existsSync)) throw new Error('Fresh explicit evidence path required');
      const config = serverDevelopmentAi({ ...process.env, NODE_ENV: 'development' });
      if (!config) throw new Error('Existing private development model configuration required');
      ({ app, pool } = await bootP2App('v91-real-' + randomUUID()));
      // Adapt only private configuration resolution; every model response is a real network response.
      vi.spyOn(app.get(AiProviderConfigService), 'resolve').mockResolvedValue(config);
      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url !== 'https://api.deepseek.com/chat/completions') return originalFetch(input, init);
        const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ role: string; content: string }> };
        const data = JSON.parse(body.messages.find(message => message.role === 'user')!.content) as Record<string, unknown>;
        const call: ModelCall = { purpose: 'availableSources' in data ? 'PLAN' : 'markdown' in data ? 'REVIEW' : 'warnings' in data ? 'WRITE' : 'OTHER',
          model: body.model, startedAt: new Date().toISOString(), requestSha256: sha256(String(init?.body)),
          ...(typeof data.goal === 'string' ? { goal: data.goal } : {}),
          ...('financialAudit' in data ? { financialAudit: data.financialAudit as ReturnType<typeof reportFinancialAudit> } : {}),
          ...('requirementContext' in data ? { requirementContext: data.requirementContext as ReportRequirementContext } : {}) };
        calls.push(call); saveEvidence();
        const response = await originalFetch(input, init);
        call.status = response.status; call.finishedAt = new Date().toISOString();
        // Record only usage and HTTP status, never headers, credentials or raw model response.
        const responseBody = await response.clone().json().catch(() => ({})) as { usage?: unknown };
        call.usage = responseBody.usage; saveEvidence(); return response;
      };
      owner = await register(app, randomUUID() + '@example.test', 'V91虚构验收用户');
      other = await register(app, randomUUID() + '@example.test', 'V91另一虚构用户');
      jobs = app.get(AuthoringJobsService); reports = app.get(ReportGenerationService);
    });
    afterAll(async () => {
      try { saveEvidence(); await app?.close(); await pool?.end(); }
      finally { globalThis.fetch = originalFetch; vi.restoreAllMocks(); }
    });
    const get = async (id: string) => (await request(app.getHttpServer()).get(`/api/conversations/${id}`).set(auth(owner.token)).expect(200)).body as Conversation;
    const submit = async (id: string, content: string, version: number) => {
      const input = { content, version, requestId: randomUUID(), authoringMode: 'DURABLE' };
      const result = (await request(app.getHttpServer()).post(`/api/conversations/${id}/messages`).set(auth(owner.token)).send(input).expect(201)).body as Conversation;
      return { input, result, job: result.authoringJobs.at(-1)! };
    };
    it('autonomously creates the corrected prompt, financial report and review; preserves version and authority boundaries', async () => {
      const conversation = (await request(app.getHttpServer()).post('/api/conversations').set(auth(owner.token))
        .send({ mode: 'TEMPORARY', title: 'V91真实模型隔离验收' }).expect(201)).body as Conversation;
      const first = await submit(conversation.id, '在湖北荆门开洗车店的商业评估报告，预算10万元，租赁门店2个工位，人工洗车加基础美容；参数为开发验收假设。', 0);
      expect(first.job.status).toBe('QUEUED'); expect(calls).toHaveLength(0);
      await jobs.process(first.job.jobId);
      const prior = await get(conversation.id), oldMessage = prior.messages.at(-1)!;
      expect(agentReportSchema.parse(oldMessage.structuredPayload.report).stage).toBe('QUEUED');
      const next = await submit(conversation.id, '预算改为15万元，总投入上限15万元，重新生成完整报告；这是开发隔离验收数据，不代表真实开店资金。', prior.version);
      const newMessageId = next.result.messages.at(-1)!.id;
      expect(calls).toHaveLength(0);
      await request(app.getHttpServer()).get(`/api/authoring-jobs/${next.job.jobId}`).set(auth(other.token)).expect(404);
      await request(app.getHttpServer()).get(`/api/consumer/goal-experience/${conversation.id}`).set(auth(other.token)).expect(404);
      const previousEnv = { NODE_ENV: process.env.NODE_ENV, APP_ROLE: process.env.APP_ROLE };
      try {
        process.env.NODE_ENV = 'development'; process.env.APP_ROLE = 'execution-worker';
        jobs.onModuleInit(); reports.onModuleInit();
      } finally { process.env.NODE_ENV = previousEnv.NODE_ENV; process.env.APP_ROLE = previousEnv.APP_ROLE; }
      const deadline = Date.now() + 810_000;
      while (Date.now() < deadline) {
        const current = await get(conversation.id);
        const parsed = agentReportSchema.safeParse(current.messages.find(message => message.id === newMessageId)?.structuredPayload.report);
        if (parsed.success) {
          latestReport = parsed.data;
          if (stages.at(-1) !== latestReport.stage) { stages.push(latestReport.stage); saveEvidence(); console.log(JSON.stringify({ stage: latestReport.stage, modelCalls: calls.length })); }
          if (reportTerminal(latestReport.stage)) break;
        } else if (['FAILED', 'CANCELLED', 'SUPERSEDED'].includes(current.authoringJobs.at(-1)!.status)) {
          throw new Error('V91_REAL_AUTHORING_HANDOFF_FAILED');
        }
        await new Promise<void>(resolve => setTimeout(resolve, 500));
      }
      expect(latestReport?.stage, latestReport?.errorCode ?? 'REPORT_TIMEOUT').toBe('COMPLETED');
      const report = latestReport!;
      expect(report.goal).toBe(next.input.content); expect(report.modelId).toBe(calls[0]!.model);
      const brief = goalBriefSchema.parse(report.requirementContext!.goalBrief);
      expect(brief.reportSubject?.kind).toBe('CAR_WASH_BUSINESS');
      expect(brief.fields.find(field => field.key === 'budget')).toMatchObject({ status: 'USER_STATED', value: '预算改为15万元' });
      expect(report.requirementContext!.userMessages.map(message => message.quote)).toEqual([first.input.content, next.input.content]);
      const planningCalls = calls.filter(call => call.purpose === 'PLAN');
      expect(planningCalls.length).toBeGreaterThan(0);
      for (const call of planningCalls) {
        expect(call.goal).toBe(next.input.content); expect(call.requirementContext).toEqual(report.requirementContext);
      }
      expect(calls.every(call => call.status === 200)).toBe(true); expect(calls.length).toBeLessThanOrEqual(10);
      expect(calls.some(call => call.purpose === 'WRITE')).toBe(true); expect(calls.some(call => call.purpose === 'REVIEW')).toBe(true);
      expect(report.plan!.prompt.length).toBeGreaterThanOrEqual(100);
      expect(report.plan!.prompt).toMatch(/荆门/); expect(report.plan!.prompt).toMatch(/15万|150000|150,000/);
      expect(report.plan!.connectionIds).toEqual([]); expect(report.plan!.financialModel).toBeTruthy();
      const calculated = calculateReportFinancial(report.plan!.financialModel!);
      for (const call of calls.filter(call => call.purpose === 'WRITE' || call.purpose === 'REVIEW'))
        expect(call.financialAudit).toEqual(reportFinancialAudit(report.plan!.financialModel));
      expect(calculated.startupYuan).toBeLessThanOrEqual(150_000);
      const m1 = report.sources.find(source => source.id === 'M1')!;
      expect(m1.provenance).toBe('MODEL_ASSUMPTIONS_CALCULATED');
      expect(JSON.parse(m1.content)).toEqual(auditedReportFinancial(report.plan!.financialModel!)); expect(m1.sha256).toBe(sha256(m1.content));
      expect(report.sources.filter(source => source.id !== 'M1')).toEqual([]);
      expect(report.markdown!.length).toBeGreaterThanOrEqual(800); expect(report.markdown).toContain(FINANCIAL_APPENDIX);
      expect(report.markdown).toContain('### 收入敏感性（程序计算，模型假设）');
      for (const section of report.plan!.sections) expect(report.markdown).toContain(section);
      expect(report.review?.issues).toEqual([]);
      const finalConversation = await get(conversation.id);
      expect(agentReportSchema.parse(finalConversation.messages.find(message => message.id === oldMessage.id)!.structuredPayload.report).stage).toBe('SUPERSEDED');
      expect(finalConversation.authoringJobs.at(-1)!.status).toBe('SUCCEEDED'); expect(finalConversation.planId).toBeNull();
      const projection = (await request(app.getHttpServer()).get(`/api/consumer/goal-experience/${conversation.id}`).set(auth(owner.token)).expect(200)).body;
      expect(projection.statusGroup).toBe('COMPLETED'); expect(projection.report).toMatchObject({ messageId: newMessageId, stage: 'COMPLETED', marketFactsVerified: false });
      const callsBeforeReplay = calls.length;
      await request(app.getHttpServer()).post(`/api/conversations/${conversation.id}/messages`).set(auth(owner.token)).send(next.input).expect(201);
      await jobs.process(next.job.jobId); await reports.process(newMessageId); await reports.process(oldMessage.id);
      expect(calls).toHaveLength(callsBeforeReplay); expect((await get(conversation.id)).messages).toHaveLength(4);
      const [counts] = await pool.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM plans WHERE user_id=UUID_TO_BIN(?)) plans, '
        + '(SELECT COUNT(*) FROM executions WHERE user_id=UUID_TO_BIN(?)) executions, (SELECT COUNT(*) FROM capability_invocations WHERE user_id=UUID_TO_BIN(?)) invocations, '
        + '(SELECT COUNT(*) FROM device_tasks WHERE user_id=UUID_TO_BIN(?)) deviceTasks, (SELECT COUNT(*) FROM truth_records WHERE user_id=UUID_TO_BIN(?)) truths, '
        + '(SELECT COUNT(*) FROM connections WHERE user_id=UUID_TO_BIN(?)) connections', Array(6).fill(owner.userId));
      expect(counts[0]).toMatchObject({ plans: 0, executions: 0, invocations: 0, deviceTasks: 0, truths: 0, connections: 0 });
      completed = true; stages.push('Replay fenced; no execution or Truth; owner isolation verified'); saveEvidence();
    });
  });
