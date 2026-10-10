import { z } from 'zod';
import { reportFinancialSchema } from './report-financial';

export const reportPlanSchema = z.object({
  title: z.string().min(1).max(180),
  prompt: z.string().min(100).max(6000),
  sections: z.array(z.string().min(1).max(100)).min(4).max(12),
  assumptions: z.array(z.string().max(500)).max(20),
  researchQuestions: z.array(z.string().max(300)).max(12),
  connectionIds: z.array(z.string().uuid()).max(3),
  webQueries: z.array(z.string().min(2).max(250)).max(2).optional(),
  financialModel: reportFinancialSchema.nullable().optional(),
}).strict();
export const reportSourceSchema = z.object({
  id: z.string().max(100), label: z.string().max(200),
  provenance: z.enum(['USER_UPLOADED_UNVERIFIED', 'SOURCE_RESPONSE_ONLY', 'MODEL_ASSUMPTIONS_CALCULATED']),
  content: z.string().max(16000), sha256: z.string().length(64), observedAt: z.string(),
  connectionId: z.string().uuid().optional(),
  url: z.string().url().max(2000).refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; }).optional(), publishedAt: z.string().max(100).nullable().optional(),
  query: z.string().max(250).optional(), retrievalMethod: z.enum(['SEARCH_RESULT', 'AUTHORIZED_SITE_DISCOVERY']).optional(),
  authorityHash: z.string().length(64).optional(), capabilityKey: z.string().max(100).optional(),
}).strict();
export const agentReportSchema = z.object({
  version: z.literal('agent-report.v1'), revision: z.number().int().nonnegative(),
  stage: z.enum(['QUEUED', 'PLANNING', 'RESEARCHING', 'WRITING', 'REVIEWING', 'COMPLETED', 'FAILED', 'SUPERSEDED']),
  goal: z.string().max(12000), conversationVersion: z.number().int().nonnegative(),
  plan: reportPlanSchema.optional(), sources: z.array(reportSourceSchema).max(7),
  warnings: z.array(z.string().max(500)).max(30),
  markdown: z.string().max(48000).optional(),
  review: z.object({ issues: z.array(z.string().max(500)).max(20), checkedAt: z.string() }).optional(),
  modelId: z.string().max(120).optional(), errorCode: z.string().max(100).optional(),
  updatedAt: z.string(),
}).strict();
export type AgentReport = z.infer<typeof agentReportSchema>;
export type ReportPlan = z.infer<typeof reportPlanSchema>;
export type ReportSource = z.infer<typeof reportSourceSchema>;
export const reportTerminal = (stage: AgentReport['stage']) => ['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(stage);
/** Only direct generation requests; uploaded text never enters this decision. */
export function requestsReport(intent: string) {
  return /报告/.test(intent) && /生成|写|撰写|输出|制作|评估|分析/.test(intent)
    && !/每天|每周|每月|每日|定期|周期性/.test(intent)
    && !/不要.{0,8}(生成|写|制作).{0,8}报告|不用.{0,8}(生成|写|制作).{0,8}报告|仅.{0,4}(翻译|解释)|只.{0,4}(翻译|解释)/.test(intent);
}
export function validateReportDocument(markdown: string, plan: ReportPlan, sources: ReportSource[]) {
  const issues: string[] = [];
  if (markdown.trim().length < 800) issues.push('正文过短，未形成完整报告');
  if (plan.sections.some(section => !markdown.includes(section))) issues.push('缺少提纲中的章节');
  const allowed = new Set(sources.map(source => source.id));
  if ([...markdown.matchAll(/\[((?:S|M)\d+)\]/g)].some(match => !allowed.has(match[1]!))) issues.push('引用了未读取的来源');
  if (!sources.length && !/假设|测算|待核实/.test(markdown)) issues.push('缺少来源时必须标明假设');
  const pageUrls = new Set(sources.flatMap(source => source.url ? [source.url] : []));
  if (pageUrls.size && [...markdown.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].some(match => !pageUrls.has(match[1]!))) issues.push('网页链接不是本次实际读取的原文地址');
  return issues;
}
