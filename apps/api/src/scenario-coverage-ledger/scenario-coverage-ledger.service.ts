import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BATCH_10_WAVE_1_CONCLUSION,
  SCENARIO_COVERAGE_LEDGER,
  SCENARIO_COVERAGE_LEDGER_REVISION,
  scenarioByKey,
  scenarioCoverageByKey,
} from '@lazy-armor/plan-schema';
import { ReadinessEvidenceService, type ScenarioRuntimeEvidence } from '../runtime-catalog/readiness-evidence.service';

@Injectable()
export class ScenarioCoverageLedgerService {
  constructor(private readonly evidence: ReadinessEvidenceService) {}

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

  /**
   * User-scoped runtime evidence layered on top of the immutable contract.
   * The static ledger answers "what this scenario needs"; the runtime projection
   * answers "what this user actually has right now".
   */
  async runtimeEvidence(userId: string, scenarioKey: string): Promise<{ ledgerRevision: number; scenarioKey: string; staticContract: ReturnType<ScenarioCoverageLedgerService['get']>; runtime: ScenarioRuntimeEvidence }> {
    const staticContract = this.get(scenarioKey);
    const scenario = scenarioByKey(scenarioKey);
    if (!scenario) throw new NotFoundException('Scenario not found');
    const runtime = await this.evidence.projectScenarioRuntimeEvidence(userId, scenario);
    return { ledgerRevision: SCENARIO_COVERAGE_LEDGER_REVISION, scenarioKey, staticContract, runtime };
  }
}
