import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BATCH_10_WAVE_1_CONCLUSION,
  SCENARIO_COVERAGE_LEDGER,
  SCENARIO_COVERAGE_LEDGER_REVISION,
  scenarioCoverageByKey,
} from '@lazy-armor/plan-schema';

@Injectable()
export class ScenarioCoverageLedgerService {
  /** Full immutable plan-schema projection, not a mutable user-specific status. */
  list() {
    return {
      ledgerRevision: SCENARIO_COVERAGE_LEDGER_REVISION,
      scenarioCount: SCENARIO_COVERAGE_LEDGER.length,
      entries: SCENARIO_COVERAGE_LEDGER,
    };
  }

  summary() {
    return {
      ledgerRevision: SCENARIO_COVERAGE_LEDGER_REVISION,
      scenarioCount: SCENARIO_COVERAGE_LEDGER.length,
      batch10Wave1: BATCH_10_WAVE_1_CONCLUSION,
    };
  }

  get(scenarioKey: string) {
    const entry = scenarioCoverageByKey(scenarioKey);
    if (!entry) throw new NotFoundException('Scenario Coverage Ledger entry not found');
    return entry;
  }

  batch10Wave1() {
    const keys = new Set(BATCH_10_WAVE_1_CONCLUSION.scenarioKeys);
    return {
      ...BATCH_10_WAVE_1_CONCLUSION,
      entries: SCENARIO_COVERAGE_LEDGER.filter((entry) => keys.has(entry.scenarioKey)),
    };
  }
}
