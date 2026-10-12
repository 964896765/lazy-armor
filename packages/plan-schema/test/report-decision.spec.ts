import { describe, expect, it } from 'vitest';
import { reportDecisionContent, reportDecisionInputSchema } from '../src/report-decision';
const id = '11111111-1111-4111-8111-111111111111';
const input = { requestId: 'decision-request', conversationId: id, messageId: id, reportRevision: 4, reportHash: 'a'.repeat(64),
  decision: '先做现场调查', rationale: '租金未知', expectedOutcome: '取得三家实际报价', confirmed: true };
describe('report decisions are user choices with explicit provenance', () => {
  it('requires confirmation, a frozen report version and valid input bounds', () => {
    expect(reportDecisionInputSchema.safeParse(input).success).toBe(true);
    for (const patch of [{ confirmed: false }, { reportHash: 'success' }, { decision: ' ' }, { decision: 'a'.repeat(501) }, { marketVerified: true }])
      expect(reportDecisionInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it('keeps expectations and conclusions separate from verified outcomes', () => {
    const content = reportDecisionContent(input);
    expect(content).toContain('本人决定：先做现场调查'); expect(content).toContain('预期（尚未验证）'); expect(content).toContain('不代表市场事实或经营结果已核实');
  });
  it('fits original Memory content bounds even at the full user input limits', () => {
    expect(reportDecisionContent({ decision: '决'.repeat(500), rationale: '理'.repeat(300), expectedOutcome: '果'.repeat(100) }).length).toBeLessThanOrEqual(1000);
  });
});
