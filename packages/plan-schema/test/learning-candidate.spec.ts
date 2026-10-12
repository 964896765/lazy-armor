import { describe, expect, it } from 'vitest';
import { learningSourceSchema, learningSummary } from '../src/learning-candidate';
const id = '11111111-1111-4111-8111-111111111111';
const source = { executionId: id, executionStepId: id, operationId: id, evidenceId: id, planVersionId: null, actionIntentId: null,
  policyId: id, policyHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), requestHash: 'c'.repeat(64), inputFingerprint: 'd'.repeat(64),
  definitionHash: 'e'.repeat(64),
  method: 'OPERATION_LOOKUP', outcome: 'SUCCEEDED' as const, actionType: 'FIXTURE', scope: '隔离操作', verifiedAt: '2026-10-12T01:00:00.000Z', connection: null };
describe('bounded learning evidence contract', () => {
  it('rejects unknown, unverified and unsupported outcomes', () => {
    expect(learningSourceSchema.safeParse(source).success).toBe(true);
    for (const outcome of ['OUTCOME_UNKNOWN', 'VERIFIED', 'UNKNOWN', 'CANCELLED']) expect(learningSourceSchema.safeParse({ ...source, outcome }).success).toBe(false);
  });
  it('requires exact evidence identity, policy and request hashes rather than a prose claim', () => {
    expect(learningSourceSchema.safeParse({ ...source, evidenceId: 'AI says success' }).success).toBe(false);
    expect(learningSourceSchema.safeParse({ ...source, policyHash: '' }).success).toBe(false);
    expect(learningSourceSchema.safeParse({ ...source, confidence: 1 }).success).toBe(false);
  });
  it('retains single sample and limitations for all known outcomes', () => {
    for (const outcome of ['SUCCEEDED', 'FAILED', 'PARTIALLY_SUCCEEDED'] as const) {
      const summary = learningSummary({ ...source, outcome });
      expect(summary).toContain('样本数：1'); expect(summary).toContain('不能推断未来成功率'); expect(summary).toContain('不构成执行授权');
    }
    expect(learningSummary({ ...source, outcome: 'FAILED' })).toContain('核验为失败');
  });
});
