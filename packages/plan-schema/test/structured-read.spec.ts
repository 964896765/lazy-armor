import { describe, expect, it } from 'vitest';
import { readEvidenceStatusForOutcome, resolveStructuredReadOutcome } from '../src/structured-read';

describe('StructuredRead unified outcome semantics', () => {
  it('derives VERIFIED only from truthRecordIds', () => {
    expect(resolveStructuredReadOutcome({ candidateIds: [], truthRecordIds: ['t1'] })).toBe('VERIFIED');
    expect(resolveStructuredReadOutcome({ candidateIds: ['c1'], truthRecordIds: ['t1'] })).toBe('VERIFIED');
  });

  it('maps candidate-only to NEEDS_CONFIRMATION, never VERIFIED', () => {
    expect(resolveStructuredReadOutcome({ candidateIds: ['c1'], truthRecordIds: [] })).toBe('NEEDS_CONFIRMATION');
  });

  it('maps empty candidates and truth to BLOCKED', () => {
    expect(resolveStructuredReadOutcome({ candidateIds: [], truthRecordIds: [] })).toBe('BLOCKED');
  });

  it('maps outcomes to ReadEvidence terminal statuses', () => {
    expect(readEvidenceStatusForOutcome('VERIFIED')).toBe('TRUTH_VERIFIED');
    expect(readEvidenceStatusForOutcome('NEEDS_CONFIRMATION')).toBe('NEEDS_CONFIRMATION');
    expect(readEvidenceStatusForOutcome('BLOCKED')).toBe('BLOCKED');
  });
});
