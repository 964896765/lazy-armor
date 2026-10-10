import type { AgentLoopReflection } from '@lazy-armor/plan-schema';

interface LoopResult {
  invocation: { id: string; actionIntentId: string | null };
  result: { verificationState: string; evidenceRefs: string[] } | null;
}
interface LoopCase {
  id: string; operationId: string; executionStepId: string; policyId: string;
  status: string; resultState: string;
}
interface LoopEvidence {
  caseId: string | null; operationId: string; executionStepId: string; policyId: string;
  actionIntentId: string | null; stepActionIntentId: string | null; resultState: string;
}
interface LoopStep { id: string; status: string; errorCode: string | null }
const knownStates = new Set(['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED']);

/** Read-only conclusions over immutable results and exact, committed lookup evidence. */
export function reflectLoopRun(
  run: { id: string; status: string; errorCode: string | null }, planVersionId: string,
  results: LoopResult[], cases: LoopCase[], evidence: LoopEvidence[], evaluatedAt: string, steps: LoopStep[],
): AgentLoopReflection {
  const resolved = cases.map(item => ({ item, proof: item.status === 'RESOLVED' && knownStates.has(item.resultState)
    ? evidence.find(proof => proof.caseId === item.id && proof.operationId === item.operationId &&
      proof.executionStepId === item.executionStepId && proof.policyId === item.policyId &&
      proof.resultState === item.resultState && proof.actionIntentId === proof.stepActionIntentId) : undefined }));
  const conclusions = results.map(row => {
    if (!row.result) return null;
    const lookup = row.invocation.actionIntentId && resolved.find(({ proof }) =>
      proof?.actionIntentId === row.invocation.actionIntentId);
    if (lookup) return lookup.item.resultState;
    if (row.result?.verificationState === 'VERIFIED' && row.result.evidenceRefs.length) return 'SUCCEEDED';
    return row.result?.verificationState === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : null;
  });
  const allResolved = cases.length > 0 && resolved.every(item => item.proof);
  const allVerified = results.length > 0 && conclusions.every(state => state !== null && knownStates.has(state));
  const reconciled = allResolved && allVerified && resolved.every(({ proof }) =>
    results.some(row => row.invocation.actionIntentId && row.invocation.actionIntentId === proof?.actionIntentId));
  const stepConclusion = (step: LoopStep) => resolved.find(({ item, proof }) => item.executionStepId === step.id && proof)?.item.resultState;
  const incompleteSteps = steps.some(step => step.status !== 'succeeded' && stepConclusion(step) !== 'SUCCEEDED');
  const unknown = resolved.some(item => !item.proof) || conclusions.includes('OUTCOME_UNKNOWN') ||
    steps.some(step => step.errorCode === 'OUTCOME_UNKNOWN' && !stepConclusion(step)) ||
    (run.errorCode === 'OUTCOME_UNKNOWN' && !reconciled);
  let outcome: AgentLoopReflection['outcome'];
  if (unknown) outcome = 'UNKNOWN';
  else if (run.status === 'cancelled') outcome = 'CANCELLED';
  else if (reconciled) outcome = conclusions.every(state => state === 'SUCCEEDED') ? incompleteSteps ? 'PARTIAL' : 'VERIFIED' :
    conclusions.every(state => state === 'FAILED') ? 'FAILED' : 'PARTIAL';
  else if (run.status === 'partially_succeeded') outcome = 'PARTIAL';
  else if (run.status !== 'succeeded') outcome = 'FAILED';
  else outcome = allVerified ? 'VERIFIED' : 'UNVERIFIED';
  return { executionId: run.id, planVersionId, recordedStatus: run.status, outcome,
    verifiedResultCount: new Set(results.filter((_, index) => knownStates.has(conclusions[index] ?? '')).map(row => row.invocation.id)).size,
    evaluatedAt };
}
