import { describe, it, expect } from 'vitest';
import { requestsReport, reportPlanSchema, reportSourceSchema, reportRequirementContextSchema, agentReportSchema, validateReportDocument } from '../src/agent-report';
describe('report generation contract', () => {
  it('retains legacy v1 reports and accepts a bounded optional user requirement snapshot', () => {
    const report = { version: 'agent-report.v1', revision: 0, stage: 'QUEUED', goal: '生成报告', conversationVersion: 2, sources: [], warnings: [], updatedAt: '2026-10-11T00:00:00Z' };
    expect(agentReportSchema.safeParse(report).success).toBe(true);
    const requirementContext = { userMessages: [{ messageId: 'message', quote: '预算8万元', truncated: true }] };
    expect(agentReportSchema.parse({ ...report, requirementContext }).requirementContext).toEqual(requirementContext);
    expect(reportRequirementContextSchema.safeParse({ ...requirementContext, executionAuthorized: true }).success).toBe(false);
    expect(reportRequirementContextSchema.safeParse({ userMessages: [{ messageId: 'message', quote: '字'.repeat(1001) }] }).success).toBe(false);
    expect(reportRequirementContextSchema.safeParse({ userMessages: Array.from({ length: 9 }, (_, index) => ({ messageId: String(index), quote: '用户声明' })) }).success).toBe(false);
  });
  it('routes direct report generation but respects negation and explanation', () => {
    expect(requestsReport('在湖北荆门开洗车店的商业评估报告')).toBe(true);
    expect(requestsReport('生成一份旅游可行性报告')).toBe(true);
    expect(requestsReport('不要生成商业评估报告，只解释方法')).toBe(false);
    expect(requestsReport('只解释商业评估报告')).toBe(false);
    expect(requestsReport('读取手机计算器当前结果')).toBe(false);
    expect(requestsReport('每天生成商业评估报告')).toBe(false);
  });
  it('rejects fabricated citations and incomplete documents', () => {
    const plan = reportPlanSchema.parse({ title: '报告', prompt: '编写完整评估。'.repeat(25), sections: ['市场', '成本', '盈亏', '建议'], assumptions: [], researchQuestions: [], connectionIds: [] });
    const text = '市场 成本 盈亏 建议\n假设条件。'.repeat(100);
    expect(validateReportDocument(text, plan, [])).toEqual([]);
    expect(validateReportDocument(text + '[S99]', plan, [])).toContain('引用了未读取的来源');
    expect(validateReportDocument('稍后会给你报告', plan, [])).toHaveLength(3);
  });
  it('accepts only the actual fetched HTTPS page for report links', () => {
    const plan = reportPlanSchema.parse({ title: '报告', prompt: '编写完整评估。'.repeat(25), sections: ['市场', '成本', '盈亏', '建议'], assumptions: [], researchQuestions: [], connectionIds: [] });
    const source = { id: 'S1', label: '公开原文', provenance: 'SOURCE_RESPONSE_ONLY' as const, content: '来源正文', sha256: 'a'.repeat(64), observedAt: '2026-10-10', url: 'https://example.gov.cn/report.html', publishedAt: null };
    const text = '市场 成本 盈亏 建议\n测算假设。'.repeat(100);
    expect(reportSourceSchema.parse(source).publishedAt).toBeNull();
    expect(validateReportDocument(text + '[S1](https://example.gov.cn/report.html)', plan, [source])).toEqual([]);
    expect(validateReportDocument(text + '[S1](https://example.gov.cn/invented.html)', plan, [source])).toContain('网页链接不是本次实际读取的原文地址');
    expect(reportSourceSchema.safeParse({ ...source, url: 'javascript:alert(1)' }).success).toBe(false);
    expect(reportSourceSchema.safeParse({ ...source, url: 'https://secret:password@example.gov.cn/' }).success).toBe(false);
  });
});


describe('report scheduling and document conditions', () => {
  it('keeps daily study time and monthly costs within a one-off report', () => {
    expect(requestsReport('生成学习研究报告：每天学习30分钟，预算500元')).toBe(true);
    expect(requestsReport('生成经营评估报告，分析每月固定成本')).toBe(true);
  });
  it('does not turn an explicit recurring generation request into a single report', () => {
    expect(requestsReport('每天帮我生成学习研究报告')).toBe(false);
    expect(requestsReport('生成每日GitHub动态报告')).toBe(false);
    expect(requestsReport('生成学习报告，并每天生成后续报告')).toBe(false);
  });
});
