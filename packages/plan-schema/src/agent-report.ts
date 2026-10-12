import { z } from 'zod';
import { reportFinancialSchema } from './report-financial';
import { goalBriefSchema } from './goal-brief';
import { compositionAuthoringSnapshotSchema } from './composition-authoring';
import { skillCapabilitySchema, skillMethodRefSchema } from './skill-capability';
import { reportMethodRunSchema } from './report-method';

export const reportBudgetSchema = z.object({
  deadlineAt: z.iso.datetime(), maxModelCalls: z.number().int().min(1).max(16),
  maxReservedOutputTokens: z.number().int().min(8192).max(131072),
  modelCalls: z.number().int().min(0).max(16), reservedOutputTokens: z.number().int().min(0).max(131072),
  observedTotalTokens: z.number().int().nonnegative(), usageResponses: z.number().int().min(0).max(16),
  costStatus: z.literal('NOT_PRICED'),
}).strict();
export type ReportBudget = z.infer<typeof reportBudgetSchema>;

/** Legacy writing guidance or bounded report-only method evaluation; neither compiles a Runtime recipe. */
export const reportCompositionSchema = z.object({
  adapter: z.enum(['REPORT_GUIDANCE_V1', 'REPORT_METHOD_CHAIN_V1']), snapshot: compositionAuthoringSnapshotSchema,
  methods: z.array(z.object({ ref: skillMethodRefSchema, manifest: skillCapabilitySchema }).strict()).min(1).max(3),
}).strict().superRefine((value, issue) => {
  if (value.methods.length !== value.snapshot.orderedMethodIds.length || value.methods.some((method, index) =>
    method.ref.entryId !== value.snapshot.orderedMethodIds[index] || !value.snapshot.selection.basis.methodRefs.some(ref => JSON.stringify(ref) === JSON.stringify(method.ref))))
    issue.addIssue({ code: 'custom', message: 'Report guidance must preserve exact method references and order' });
});
export type ReportComposition = z.infer<typeof reportCompositionSchema>;

/** Owner-scoped user declarations captured by the server, never verified report evidence. */
export const reportRequirementContextSchema = z.object({
  goalBrief: goalBriefSchema.optional(),
  userMessages: z.array(z.object({
    messageId: z.string().min(1).max(160), quote: z.string().min(1).max(1000), truncated: z.boolean().optional(),
  }).strict()).max(8),
  composition: reportCompositionSchema.optional(),
}).strict().superRefine((context, issue) => {
  if (new Set(context.userMessages.map(message => message.messageId)).size !== context.userMessages.length)
    issue.addIssue({ code: 'custom', message: 'Each user message snapshot occurs once' });
});

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
  stage: z.enum(['QUEUED', 'PLANNING', 'RESEARCHING', 'COMPOSING', 'WRITING', 'REVIEWING', 'COMPLETED', 'FAILED', 'SUPERSEDED']),
  goal: z.string().max(12000), conversationVersion: z.number().int().nonnegative(),
  requirementContext: reportRequirementContextSchema.optional(),
  budget: reportBudgetSchema.optional(),
  methodRuns: z.array(reportMethodRunSchema).max(3).optional(),
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
export type ReportRequirementContext = z.infer<typeof reportRequirementContextSchema>;
export const reportTerminal = (stage: AgentReport['stage']) => ['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(stage);
/** Explain why another reviewed attempt is needed without exposing internal codes. */
export function reportFailureExplanation(code?: string) {
  if (code?.startsWith('REPORT_METHOD_')) return '某个方法的输入、输出或保存结果未通过字段与引用校验，组合已停止。请回原目标核对方法与字段来源。';
  if (code?.startsWith('REPORT_BUDGET_')) return '本次生成达到时间或模型调用上限，已完成的步骤已保留。请核对需求后发起新任务。';
  if (code?.startsWith('COMPOSITION_RESOURCE_') || code === 'REPORT_SOURCE_AUTHORITY_CHANGED') return '选定来源或授权状态已变化，本次生成已停止。请回原目标核对来源与权限，系统不会自动改用其他连接。';
  if (code === 'COMPOSITION_REPORT_BINDINGS_REQUIRED') return '此历史组合尚未固定读取来源，请回原目标重新核对组合后生成。';
  if (code === 'REPORT_BOUND_SOURCE_REQUIRED' || code === 'REPORT_WEB_SOURCE_REQUIRED') return '未取得本次所需来源的可引用原文，报告尚未交付。请核对来源范围后再尝试。';
  if (code === 'REPORT_SOURCE_INVALID' || code === 'REPORT_SOURCE_OUTSIDE_BINDING') return '生成中出现不属于本次范围的来源，已阻止交付。请回原目标重新核对。';
  if (code?.startsWith('COMPOSITION_') || code === 'SKILL_CONTEXT_CHANGED') return '目标、方法或原条件已变化，请回原目标重新核对后生成。';
  return null;
}
/** Only direct generation requests; uploaded text never enters this decision. */
export function requestsReport(intent: string) {
  const frequency = /每天|每周|每月|每日|定期|周期性/.exec(intent);
  // A frequency inside the requested document is a requirement, not a request to run the report repeatedly.
  const recurring = Boolean(frequency && frequency.index < intent.indexOf('报告'))
    || /(?:每天|每周|每月|每日|定期|周期性)\s*(?:(?:自动|请|帮我|为我|给我|定时|固定|按时|都)\s*){0,3}(?:生成|写|撰写|输出|制作)[^。；\n]{0,60}报告/.test(intent);
  return /报告/.test(intent) && /生成|写|撰写|输出|制作|评估|分析/.test(intent)
    && !recurring
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
