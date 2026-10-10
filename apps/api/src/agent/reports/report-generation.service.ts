import { Inject, Injectable, OnModuleInit, OnApplicationShutdown, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { consumerConversations, consumerMessages } from '@lazy-armor/database';
import { agentReportSchema, reportTerminal, calculateReportFinancial, appendReportFinancial, type AgentReport, type ReportSource } from '@lazy-armor/plan-schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createHash } from 'node:crypto';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { workerEnabled } from '../../common/app-role';
import { ConnectionsService } from '../../connections/connections.service';
import { ReportModelService } from './report-model.service';
import { WEB_READ } from '../../connectors/public-web.connector';
import { z } from 'zod';

const webSearchResult = z.object({ data: z.object({ query: z.string(), candidates: z.array(z.object({ title: z.string(), url: z.string().url(), method: z.enum(['SEARCH_RESULT', 'AUTHORIZED_SITE_DISCOVERY']) })).max(40), warnings: z.array(z.string()).max(5) }) });
const webPageResult = z.object({ data: z.object({ page: z.object({ title: z.string().max(180), url: z.string().url().max(2000), publishedAt: z.string().max(100).nullable(), excerpt: z.string().min(100).max(10000), sha256: z.string().length(64), retrievedAt: z.string(), truncated: z.boolean(), verification: z.literal('SOURCE_RESPONSE_ONLY') }) }) });

/** Internal document generation only. No Plan execution, approval, mutation tools or Truth writes. */
@Injectable()
export class ReportGenerationService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReportGenerationService.name);
  private redis: IORedis;
  private queue: Queue<{ messageId: string }>;
  private worker?: Worker<{ messageId: string }>;
  private recovery?: ReturnType<typeof setInterval>;
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly config: ConfigService,
    private readonly model: ReportModelService, private readonly connections: ConnectionsService) {
    this.redis = new IORedis(config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: null, lazyConnect: true });
    this.queue = new Queue('lazy-armor-reports', { connection: this.redis, prefix: config.get<string>('REDIS_KEY_PREFIX') || 'bull' });
  }
  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !workerEnabled('execution-worker')) return;
    this.worker = new Worker('lazy-armor-reports', job => this.process(job.data.messageId), {
      connection: this.redis, prefix: this.config.get<string>('REDIS_KEY_PREFIX') || 'bull', concurrency: 1, lockDuration: 30000,
    });
    this.worker.on('error', () => undefined);
    this.recovery = setInterval(() => { void this.recover().catch(() => undefined); }, 15000);
    void this.recover().catch(() => undefined);
  }
  initial(goal: string, conversationVersion: number, attachments: Array<{ fileName: string; content: string; contentSha256: string }>): AgentReport {
    return agentReportSchema.parse({ version: 'agent-report.v1', revision: 0, stage: 'QUEUED', goal,
      conversationVersion, sources: attachments.slice(0, 3).map((a, i) => ({ id: `S${i + 1}`, label: a.fileName,
        provenance: 'USER_UPLOADED_UNVERIFIED', content: a.content.slice(0, 16000), sha256: a.contentSha256, observedAt: new Date().toISOString() })),
      warnings: [], updatedAt: new Date().toISOString() });
  }
  async enqueue(messageId: string) {
    await this.queue.add('generate-report', { messageId }, { jobId: messageId, attempts: 1, removeOnComplete: true, removeOnFail: true });
  }
  private async recover() {
    const rows = await this.db.select({ id: consumerMessages.id }).from(consumerMessages)
      .where(and(eq(consumerMessages.role, 'assistant'), sql`JSON_UNQUOTE(JSON_EXTRACT(${consumerMessages.structuredPayload}, '$.report.stage')) IN ('QUEUED','PLANNING','RESEARCHING','WRITING','REVIEWING')`)).limit(20);
    for (const row of rows) await this.enqueue(row.id);
  }
  private async load(messageId: string) {
    const rows = await this.db.select({ message: consumerMessages, conversation: consumerConversations }).from(consumerMessages)
      .innerJoin(consumerConversations, eq(consumerMessages.conversationId, consumerConversations.id)).where(eq(consumerMessages.id, messageId)).limit(1);
    const row = rows[0]; const parsed = agentReportSchema.safeParse(row?.message.structuredPayload?.report);
    if (!row || !parsed.success || reportTerminal(parsed.data.stage)) return null;
    return { ...row, report: parsed.data };
  }
  private async save(messageId: string, report: AgentReport, patch: Partial<AgentReport>) {
    return this.db.transaction(async tx => {
      const row = (await tx.select().from(consumerMessages).where(eq(consumerMessages.id, messageId)).for('update'))[0];
      const current = agentReportSchema.safeParse(row?.structuredPayload?.report);
      if (!row || !current.success || reportTerminal(current.data.stage) || current.data.revision !== report.revision) throw new Error('REPORT_STATE_CHANGED');
      const conversation = (await tx.select().from(consumerConversations).where(eq(consumerConversations.id, row.conversationId)).for('update'))[0];
      const superseded = !conversation || conversation.deletedAt || conversation.archivedAt || conversation.version !== report.conversationVersion;
      const next = agentReportSchema.parse({ ...report, ...patch, ...(superseded ? { stage: 'SUPERSEDED', markdown: undefined } : {}), revision: report.revision + 1, updatedAt: new Date().toISOString() });
      const content = next.stage === 'COMPLETED' ? `${next.plan?.title ?? '报告'}已生成。可查看完整正文、提示词、来源与检查结果。`
        : next.stage === 'FAILED' ? '报告暂未完成，已保留需求和已完成的生成步骤。请重新发送报告需求以发起新任务。'
        : next.stage === 'SUPERSEDED' ? '该报告目标已更新，历史生成任务已停止。'
        : '正在自主生成报告：整理目标、资料、正文与检查结果。';
      await tx.update(consumerMessages).set({ content, structuredPayload: { ...row.structuredPayload, report: next } }).where(eq(consumerMessages.id, messageId));
      return next;
    });
  }
  private async assertSources(userId: string, sources: ReportSource[]) {
    for (const source of sources) if (source.connectionId && source.capabilityKey && source.authorityHash) {
      try { await this.connections.assertConsumerReadAuthority({ userId, connectionId: source.connectionId, capabilityKey: source.capabilityKey, authorityHash: source.authorityHash }); }
      catch { throw new Error('REPORT_SOURCE_AUTHORITY_CHANGED'); }
    }
  }
  async process(messageId: string) {
    const row = await this.load(messageId); if (!row) return;
    let state = row.report; const userId = row.conversation.userId;
    const advance = async (patch: Partial<AgentReport>) => { state = await this.save(messageId, state, patch); if (reportTerminal(state.stage) && state.stage !== 'COMPLETED') throw new Error('REPORT_STOPPED'); };
    try {
      await advance({ stage: state.plan ? state.stage : 'PLANNING' });
      const available = (await this.connections.list(userId)).filter(c => ['public_http_json', 'public_web_research'].includes(c.connectorId) && c.status === 'connected').slice(0, 10);
      if (!state.plan) {
        const planned = await this.model.plan(userId, state.goal, available.map(c => ({ id: c.id, name: c.externalAccountName, capability: c.connectorId === 'public_web_research' ? WEB_READ : 'READ_PUBLIC_HTTP_JSON' })));
        if (planned.value.connectionIds.some(id => !available.some(c => c.id === id))) throw new Error('REPORT_SOURCE_INVALID');
        if (/洗车/.test(state.goal) && !planned.value.financialModel) throw new Error('REPORT_FINANCIAL_MODEL_REQUIRED');
        await advance({ plan: planned.value, modelId: planned.modelId, stage: 'RESEARCHING' });
      }
      if (state.stage === 'RESEARCHING') {
        const sources: ReportSource[] = [...state.sources]; const warnings = [...state.warnings];
        for (const id of state.plan!.connectionIds) {
          if (sources.filter(s => s.id.startsWith('S')).length >= 6) { warnings.push('本次最多采用六项资料，其余来源未读取'); break; }
          if (sources.some(s => s.connectionId === id)) continue;
          let readStep = 'authority';
          try {
            const connection = available.find(c => c.id === id)!;
            if (connection.connectorId === 'public_web_research') {
              const authority = await this.connections.captureConsumerReadAuthority(userId, id, WEB_READ);
              const queries = state.plan!.webQueries?.length ? state.plan!.webQueries : state.plan!.researchQuestions.slice(0, 1);
              const candidates: z.infer<typeof webSearchResult>['data']['candidates'] = [];
              const candidateQueries = new Map<string, string>();
              const query = queries[0]?.slice(0, 250) || state.goal.slice(0, 250);
              for (const [index, words] of (queries.length ? queries : [query]).entries()) {
                readStep = `search-${index}`;
                const found = webSearchResult.parse(await this.connections.invokeConsumerRead(userId, id, { capability: WEB_READ, input: { mode: 'search', query: words.slice(0, 250) }, requestId: `report-${messageId}-${id}-search-${index}` })).data;
                if (found.query !== words.slice(0, 250).trim()) throw new Error('REPORT_SOURCE_INVALID');
                candidates.push(...found.candidates); warnings.push(...found.warnings);
                for (const candidate of found.candidates) if (!candidateQueries.has(candidate.url)) candidateQueries.set(candidate.url, found.query);
              }
              const unique = [...new Map(candidates.map(c => [c.url, c])).values()].slice(0, 40);
              readStep = 'select';
              const selection = await this.model.chooseWebSources(userId, state.goal, state.plan!, unique);
              if (selection.value.urls.some(url => !unique.some(c => c.url === url))) throw new Error('REPORT_SOURCE_INVALID');
              if (!selection.value.urls.length) warnings.push('当前候选中未选出与报告相关的原文，未将候选标题作为证据');
              for (const [index, url] of [...new Set(selection.value.urls)].slice(0, 3).entries()) {
                if (sources.length >= 6) break;
                try {
                  const page = webPageResult.parse(await this.connections.invokeConsumerRead(userId, id, { capability: WEB_READ, input: { mode: 'page', url }, requestId: `report-${messageId}-${id}-page-${index}` })).data.page;
                  if (page.url !== url || createHash('sha256').update(page.excerpt).digest('hex') !== page.sha256) throw new Error('REPORT_SOURCE_INVALID');
                  await this.connections.assertConsumerReadAuthority(authority);
                  sources.push({ id: `S${sources.filter(s => s.id.startsWith('S')).length + 1}`, connectionId: id, label: page.title, provenance: 'SOURCE_RESPONSE_ONLY',
                    content: page.excerpt, sha256: page.sha256, observedAt: page.retrievedAt, url, publishedAt: page.publishedAt, query: candidateQueries.get(url) ?? query,
                    retrievalMethod: unique.find(c => c.url === url)!.method, authorityHash: authority.authorityHash, capabilityKey: WEB_READ });
                  if (page.truncated) warnings.push('一个网页来源仅保留前一万字符正文，未取得部分不能作为依据');
                } catch (error) {
                  this.logger.warn(`Report ${messageId} page ${index} failed: ${error instanceof Error ? error.name : 'unknown'}; URL ${url}`);
                  if (error instanceof Error && error.message === 'REPORT_SOURCE_INVALID') throw error;
                  warnings.push('一个选定网页当前不可读取，未将其内容用于报告');
                }
              }
              continue;
            }
            const authority = await this.connections.captureConsumerReadAuthority(userId, id, 'READ_PUBLIC_HTTP_JSON');
            const result = await this.connections.invokeConsumerRead(userId, id, { capability: 'READ_PUBLIC_HTTP_JSON', input: {}, requestId: `report-${messageId}-${id}` });
            const content = JSON.stringify(result).slice(0, 16000);
            sources.push({ id: `S${sources.length + 1}`, connectionId: id, label: available.find(c => c.id === id)?.externalAccountName || '已授权公开接口', provenance: 'SOURCE_RESPONSE_ONLY', content,
              sha256: createHash('sha256').update(content).digest('hex'), observedAt: new Date().toISOString(), authorityHash: authority.authorityHash, capabilityKey: 'READ_PUBLIC_HTTP_JSON' });
          } catch (error) {
            const code = error instanceof Error && /^(REPORT_[A-Z0-9_]+|AI_[A-Z0-9_]+)$/.test(error.message) ? error.message : error instanceof Error ? error.name : 'unknown';
            this.logger.warn(`Report ${messageId} source failed at ${readStep}: ${code}`);
            if (error instanceof Error && /^REPORT_(SOURCE_INVALID|MODEL_)/.test(error.message)) throw error;
            warnings.push('一个计划来源当前不可读取，未将其内容用于报告');
          }
        }
        const requiresWeb = Boolean(state.plan!.webQueries?.length) || state.plan!.connectionIds.some(id => available.find(c => c.id === id)?.connectorId === 'public_web_research');
        if (requiresWeb && !sources.some(source => source.capabilityKey === WEB_READ && source.url)) {
          await advance({ sources, warnings: [...new Set([...warnings, '本任务需要网页原文，但未取得可引用的授权网页资料；未将假设稿作为检索完成结果'])].slice(0, 30), stage: 'FAILED', errorCode: 'REPORT_WEB_SOURCE_REQUIRED' });
          return;
        }
        if (!sources.length) warnings.push('未取得可引用的授权资料；本报告采用明确假设测算，本地市场数据待实地核实');
        if (state.plan!.financialModel && !sources.some(s => s.id === 'M1')) {
          const content = JSON.stringify(calculateReportFinancial(state.plan!.financialModel));
          sources.push({ id: 'M1', label: '模型假设与程序计算结果', provenance: 'MODEL_ASSUMPTIONS_CALCULATED', content,
            sha256: createHash('sha256').update(content).digest('hex'), observedAt: new Date().toISOString() });
        }
        await this.assertSources(userId, sources);
        await advance({ sources, warnings: [...new Set(warnings)].slice(0, 30), stage: 'WRITING' });
      }
      await this.assertSources(userId, state.sources);
      if (!state.markdown) {
        const written = await this.model.write(userId, state.goal, state.plan!, state.sources, state.warnings);
        await advance({ markdown: state.plan!.financialModel ? appendReportFinancial(written.value.markdown, state.plan!.financialModel) : written.value.markdown, modelId: written.modelId, stage: 'REVIEWING' });
      }
      const reviewed = await this.model.review(userId, state.markdown!, state.plan!, state.sources);
      if (reviewed.value.issues.length) {
        const fixed = await this.model.write(userId, state.goal, state.plan!, state.sources, state.warnings, { markdown: state.markdown!, issues: reviewed.value.issues });
        await advance({ markdown: state.plan!.financialModel ? appendReportFinancial(fixed.value.markdown, state.plan!.financialModel) : fixed.value.markdown, stage: 'REVIEWING' });
      }
      const final = reviewed.value.issues.length ? await this.model.review(userId, state.markdown!, state.plan!, state.sources) : reviewed;
      await this.assertSources(userId, state.sources);
      if (final.value.issues.length) {
        await advance({ review: { issues: final.value.issues, checkedAt: new Date().toISOString() }, stage: 'FAILED', errorCode: 'REPORT_REVIEW_INCOMPLETE' });
      } else await advance({ review: { issues: [], checkedAt: new Date().toISOString() },
        warnings: [...state.warnings, ...(final.value.suggestions ?? []).map(s => `检查建议：${s}`)].slice(0, 30), stage: 'COMPLETED' });
    } catch (error) {
      if (error instanceof Error && ['REPORT_STOPPED', 'REPORT_STATE_CHANGED'].includes(error.message)) return;
      const reason = error instanceof Error && /^(REPORT_[A-Z0-9_]+|AI_[A-Z0-9_]+)$/.test(error.message) ? error.message : 'REPORT_GENERATION_FAILED';
      this.logger.warn(`Report ${messageId} failed in ${state.stage}: ${reason}; error type ${error instanceof Error ? error.name : 'unknown'}`);
      if (!reportTerminal(state.stage)) await this.save(messageId, state, { stage: 'FAILED', errorCode: reason }).catch(() => undefined);
    }
  }
  async onApplicationShutdown() { if (this.recovery) clearInterval(this.recovery); await this.worker?.close(); await this.queue.close(); if (this.redis.status !== 'end') await this.redis.quit(); }
}
