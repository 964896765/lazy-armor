import { describe, expect, it } from 'vitest';
import { reflectLoopRun } from '../src/agent/loop/agent-loop-reflection';

type Result = Parameters<typeof reflectLoopRun>[2][number];
type Case = Parameters<typeof reflectLoopRun>[3][number];
type Evidence = Parameters<typeof reflectLoopRun>[4][number];
const run = { id: 'run', status: 'failed', errorCode: 'OUTCOME_UNKNOWN' };
const evaluatedAt = '2026-10-10T08:00:00.000Z';
const result: Result = { invocation: { id: 'invocation', actionIntentId: 'intent' },
  result: { verificationState: 'OUTCOME_UNKNOWN', evidenceRefs: ['initial-unknown'] } };
const caseRow: Case = { id: 'case', operationId: 'operation', executionStepId: 'step', policyId: 'policy', status: 'RESOLVED', resultState: 'SUCCEEDED' };
const proof: Evidence = { caseId: 'case', operationId: 'operation', executionStepId: 'step', policyId: 'policy', actionIntentId: 'intent', stepActionIntentId: 'intent', resultState: 'SUCCEEDED' };
const steps = [{ id: 'step', status: 'failed', errorCode: 'OUTCOME_UNKNOWN' }];
const reflect = (results = [result], cases = [caseRow], evidence = [proof], execution = run, executionSteps = steps) => reflectLoopRun(execution, 'version', results, cases, evidence, evaluatedAt, executionSteps);

describe('Loop reflection follows exact evidence without changing recorded results', () => {
  it.each([['SUCCEEDED', 'VERIFIED'], ['PARTIALLY_SUCCEEDED', 'PARTIAL'], ['FAILED', 'FAILED']] as const)(
    'closes known %s lookup results while preserving the failed execution and UNKNOWN Ledger', (state, outcome) => {
      const original = structuredClone(result);
      expect(reflect([result], [{ ...caseRow, resultState: state }], [{ ...proof, resultState: state }])).toMatchObject({
        executionId: 'run', planVersionId: 'version', recordedStatus: 'failed', outcome, verifiedResultCount: 1, evaluatedAt });
      expect(result).toEqual(original);
    });
  it.each(['caseId', 'operationId', 'executionStepId', 'policyId', 'actionIntentId', 'stepActionIntentId', 'resultState'] as const)(
    'rejects evidence with an unrelated %s', field => {
      expect(reflect([result], [caseRow], [{ ...proof, [field]: 'unrelated' }])).toMatchObject({ outcome: 'UNKNOWN', verifiedResultCount: 0 });
    });
  it('does not promote RESOLVED metadata, pending cases or missing durable results to verified', () => {
    expect(reflect([result], [caseRow], []).outcome).toBe('UNKNOWN');
    expect(reflect([result], [{ ...caseRow, status: 'OPEN' }], [proof]).outcome).toBe('UNKNOWN');
    expect(reflect([{ ...result, result: null }]).outcome).toBe('UNKNOWN');
    expect(reflect([], [], [], { ...run, status: 'succeeded', errorCode: null }, [{ ...steps[0], status: 'succeeded', errorCode: null }])).toMatchObject({ outcome: 'UNVERIFIED', verifiedResultCount: 0 });
  });
  it('counts each verified invocation once, including ordinary results alongside lookup results', () => {
    const ordinary: Result = { invocation: { id: 'other-invocation', actionIntentId: 'other-intent' },
      result: { verificationState: 'VERIFIED', evidenceRefs: ['read-back'] } };
    expect(reflect([result, ordinary], [caseRow], [proof, { ...proof }])).toMatchObject({ outcome: 'VERIFIED', verifiedResultCount: 2 });
  });
  it('keeps a missing or still-unknown invocation visible even when another lookup succeeds', () => {
    const pending: Result = { invocation: { id: 'pending', actionIntentId: 'pending-intent' }, result: null };
    expect(reflect([result, pending])).toMatchObject({ outcome: 'UNKNOWN', verifiedResultCount: 1 });
    expect(reflect([result, { ...pending, result: result.result }]).outcome).toBe('UNKNOWN');
  });
  it('requires all cases and their invocation identities to be accounted for', () => {
    const extra = { ...caseRow, id: 'other-case', operationId: 'other-operation', executionStepId: 'other-step' };
    const extraProof = { ...proof, caseId: extra.id, operationId: extra.operationId, executionStepId: extra.executionStepId,
      actionIntentId: 'other-intent', stepActionIntentId: 'other-intent' };
    expect(reflect([result], [caseRow, extra], [proof, extraProof]).outcome).toBe('UNKNOWN');
  });
  it('reports mixed confirmed success and failure as partial, without masking another unresolved case', () => {
    const other: Result = { ...result, invocation: { id: 'other', actionIntentId: 'other-intent' } };
    const failed = { ...caseRow, id: 'failed-case', operationId: 'failed-operation', executionStepId: 'failed-step', resultState: 'FAILED' };
    const failedProof = { ...proof, caseId: failed.id, operationId: failed.operationId, executionStepId: failed.executionStepId,
      actionIntentId: 'other-intent', stepActionIntentId: 'other-intent', resultState: 'FAILED' };
    expect(reflect([result, other], [caseRow, failed], [proof, failedProof])).toMatchObject({ outcome: 'PARTIAL', verifiedResultCount: 2 });
    expect(reflect([result, other], [caseRow, { ...failed, status: 'NEEDS_USER' }], [proof, failedProof]).outcome).toBe('UNKNOWN');
  });
  it('preserves explicit cancellation after a known lookup result', () => {
    expect(reflect([result], [caseRow], [proof], { ...run, status: 'cancelled' })).toMatchObject({ outcome: 'CANCELLED', recordedStatus: 'cancelled' });
    expect(reflect([result], [], [], { ...run, status: 'cancelled' }).outcome).toBe('UNKNOWN');
  });
  it('does not call the whole run successful when another step failed or was never executed', () => {
    for (const status of ['failed', 'skipped', 'pending', 'cancelled'])
      expect(reflect([result], [caseRow], [proof], run, [...steps, { id: 'uncompleted', status, errorCode: null }]).outcome).toBe('PARTIAL');
    expect(reflect([result], [caseRow], [proof], run, [...steps, { id: 'other-unknown', status: 'failed', errorCode: 'OUTCOME_UNKNOWN' }]).outcome).toBe('UNKNOWN');
  });
});
