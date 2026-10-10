import { describe, expect, it } from 'vitest';
import { agentLoopState } from '../src/agent-loop';
const active = { planStatus: 'active', resourceAvailable: true, approvalPending: false, reconciliationPending: false };
describe('Persistent loop visibility does not grant authority', () => {
  it('does not present a paused or archived plan as running because an old result was verified', () => {
    expect(agentLoopState({ ...active, planStatus: 'paused', runStatus: 'running', outcome: 'VERIFIED' })).toBe('PAUSED');
    expect(agentLoopState({ ...active, planStatus: 'archived', runStatus: 'queued' })).toBe('ENDED');
  });
  it('keeps result uncertainty ahead of retry, source loss, or a completed executor', () => {
    expect(agentLoopState({ ...active, runStatus: 'retry_wait', resourceAvailable: false, outcome: 'UNKNOWN' })).toBe('RECONCILING');
    expect(agentLoopState({ ...active, runStatus: 'succeeded', outcome: 'VERIFIED', reconciliationPending: true })).toBe('RECONCILING');
  });
  it('separates candidate confirmation, verification and verified WAIT', () => {
    expect(agentLoopState({ ...active, observationState: 'WAITING_FACT_CONFIRMATION' })).toBe('WAITING_CONFIRMATION');
    expect(agentLoopState({ ...active, runStatus: 'succeeded', outcome: 'UNVERIFIED' })).toBe('VERIFYING');
    expect(agentLoopState({ ...active, runStatus: 'succeeded', outcome: 'VERIFIED' })).toBe('WAITING');
  });
  it('makes resource loss and blocked/degraded plans visible', () => {
    expect(agentLoopState({ ...active, resourceAvailable: false, outcome: 'VERIFIED' })).toBe('WAITING_RESOURCE');
    expect(agentLoopState({ ...active, planStatus: 'blocked', resourceAvailable: false })).toBe('WAITING_RESOURCE');
    expect(agentLoopState({ ...active, planStatus: 'degraded' })).toBe('NEEDS_ATTENTION');
  });
});
