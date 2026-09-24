import { describe, expect, it } from 'vitest';
import { projectScenarioFacts } from '../src/runtime-catalog/scenario-fact-projection';

describe('scenario fact projection', () => {
  const cutoff = new Date('2026-09-23T00:00:00Z');
  const row = (factKey: string, fresh = true) => ({ value: { factKey }, createdAt: new Date(fresh ? '2026-09-23T01:00:00Z' : '2026-09-22T00:00:00Z') });
  it('does not count other scenarios as evidence for this scenario', () => {
    expect(projectScenarioFacts(['bill.amount'], [row('shipment.status')], cutoff)).toEqual({ availableFacts: [], staleFactCount: 0, hasDecidedTruth: false });
  });
  it('counts freshness per record without treating duplicate fact types as stale', () => {
    expect(projectScenarioFacts(['bill.amount'], [row('bill.amount'), row('bill.amount'), row('bill.amount', false), row('other', false)], cutoff)).toEqual({ availableFacts: ['bill.amount'], staleFactCount: 1, hasDecidedTruth: true });
  });
  it('keeps expired evidence unavailable', () => {
    expect(projectScenarioFacts(['bill.amount'], [row('bill.amount', false)], cutoff)).toEqual({ availableFacts: [], staleFactCount: 1, hasDecidedTruth: true });
  });
});
