import { describe, it, expect } from 'vitest';
import { requestsReport, reportPlanSchema, reportSourceSchema, validateReportDocument } from '../src/agent-report';
describe('report generation contract', () => {
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
