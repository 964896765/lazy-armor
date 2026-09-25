import { describe, expect, it } from 'vitest';
import { isConsumerOutcomeProjection, projectConsumerOutcome, type ConsumerOutcomeEvidence } from '../src/consumer-outcome';

const evidence = (overrides: Partial<ConsumerOutcomeEvidence> = {}): ConsumerOutcomeEvidence => ({
  executionStatus: null, approvalStatus: null, resultState: null,
  reconciliationOpen: false, reconciliationNeedsUser: false, ...overrides,
});

describe('consumer outcome projection', () => {
  it('projects a verified success as SUCCESS, not as business state', () => {
    const result = projectConsumerOutcome(evidence({ resultState: 'SUCCEEDED', executionStatus: 'succeeded' }));
    expect(result.outcome).toBe('SUCCESS');
    expect(isConsumerOutcomeProjection(result)).toBe(true);
  });

  it('projects a failed execution as FAILED', () => {
    expect(projectConsumerOutcome(evidence({ resultState: 'FAILED', executionStatus: 'failed' })).outcome).toBe('FAILED');
  });

  it('treats partially succeeded as FAILED (not full success)', () => {
    expect(projectConsumerOutcome(evidence({ resultState: 'PARTIALLY_SUCCEEDED' })).outcome).toBe('FAILED');
  });

  it('projects pending approval as PENDING_CONFIRMATION ahead of any other signal', () => {
    expect(projectConsumerOutcome(evidence({ approvalStatus: 'pending', resultState: 'SUCCEEDED' })).outcome).toBe('PENDING_CONFIRMATION');
    expect(projectConsumerOutcome(evidence({ executionStatus: 'waiting_approval' })).outcome).toBe('PENDING_CONFIRMATION');
  });

  it('projects unknown results and reconciliation as OUTCOME_UNKNOWN', () => {
    expect(projectConsumerOutcome(evidence({ resultState: 'OUTCOME_UNKNOWN' })).outcome).toBe('OUTCOME_UNKNOWN');
    expect(projectConsumerOutcome(evidence({ reconciliationOpen: true })).outcome).toBe('OUTCOME_UNKNOWN');
    expect(projectConsumerOutcome(evidence({ reconciliationNeedsUser: true })).outcome).toBe('OUTCOME_UNKNOWN');
  });

  it('never classifies missing data, offline sources, or not-yet-run plans as FAILED', () => {
    expect(projectConsumerOutcome(evidence()).outcome).toBeNull();
    expect(projectConsumerOutcome(evidence({ executionStatus: 'running' })).outcome).toBeNull();
    expect(projectConsumerOutcome(evidence({ executionStatus: 'queued' })).outcome).toBeNull();
  });
});
