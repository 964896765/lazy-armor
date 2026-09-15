import { describe, expect, it } from 'vitest';
import { SCENARIO_COVERAGE_LEDGER_REVISION } from '@lazy-armor/plan-schema';
import { ScenarioCoverageLedgerService } from '../src/scenario-coverage-ledger/scenario-coverage-ledger.service';

describe('Scenario Coverage Ledger API projection', () => {
  const service = new ScenarioCoverageLedgerService();

  it('returns the immutable 96-entry ledger and exact Wave 1 46/46 conclusion', () => {
    const list = service.list();
    const wave = service.batch10Wave1();

    expect(list).toMatchObject({
      ledgerRevision: SCENARIO_COVERAGE_LEDGER_REVISION,
      scenarioCount: 96,
    });
    expect(list.entries).toHaveLength(96);
    expect(wave).toMatchObject({
      numerator: 46,
      denominator: 46,
      complete: true,
      actualCounts: {
        finance: 6,
        daily_life: 5,
        family: 5,
        work: 6,
        content: 6,
        vehicle: 6,
        device: 6,
        digital_account: 6,
      },
    });
    expect(wave.entries).toHaveLength(46);
  });

  it('returns one complete scenario projection and rejects unknown keys', () => {
    expect(service.get('finance.bill')).toMatchObject({
      scenarioKey: 'finance.bill',
      definition: { immutableRevision: true },
      sourceCapability: { providerKey: 'manual' },
      actionCapability: { providerKey: 'internal' },
      backendReadiness: { state: 'MANUAL_READY' },
      mobileReadiness: { state: 'BLOCKED_PROVIDER' },
    });
    expect(() => service.get('missing.scenario')).toThrow('Scenario Coverage Ledger entry not found');
  });

  it('exposes a compact machine-readable summary without duplicating entries', () => {
    const summary = service.summary();
    expect(summary).toMatchObject({
      ledgerRevision: SCENARIO_COVERAGE_LEDGER_REVISION,
      scenarioCount: 96,
      batch10Wave1: { numerator: 46, denominator: 46, complete: true },
    });
    expect(summary).not.toHaveProperty('entries');
  });
});
