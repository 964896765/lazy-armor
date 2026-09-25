import { Injectable } from '@nestjs/common';
import { buildDeterministicPlanOffer } from '@lazy-armor/plan-schema';
import { RuntimeCatalogRegistryService } from '../runtime-catalog/runtime-catalog-registry.service';
import { ReadinessEvidenceService } from '../runtime-catalog/readiness-evidence.service';
import type { CreatePlanOfferDto } from './dto';

/**
 * Read-only offer generation. It projects the registered Scenario contract and
 * current user-scoped runtime evidence; it does not create or activate a Plan.
 */
@Injectable()
export class PlanningOffersService {
  constructor(
    private readonly catalog: RuntimeCatalogRegistryService,
    private readonly readiness: ReadinessEvidenceService,
  ) {}

  async create(userId: string, request: CreatePlanOfferDto) {
    const scenario = this.catalog.getScenario(request.scenarioKey);
    const strategy = this.catalog.getStrategy(scenario.defaultStrategy);
    const runtime = await this.readiness.projectScenarioRuntimeEvidence(userId, scenario);
    return buildDeterministicPlanOffer({
      request,
      scenario,
      strategy,
      readiness: runtime.product,
      usableCapabilities: runtime.capabilities.filter((item) => item.usable).map((item) => item.capabilityKey),
      availableFacts: runtime.availableFacts,
      manualInputAvailable: runtime.manualInputAvailable,
      generatedAt: runtime.evaluatedAt,
    });
  }
}
