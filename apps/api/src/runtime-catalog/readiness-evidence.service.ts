import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { connections, truthRecords, sourceObservations, candidateFacts, appReadSessions } from '@lazy-armor/database';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { evaluateScenarioReadiness, type ScenarioDefinition, type ScenarioReadiness, type ScenarioReadinessInput } from '@lazy-armor/plan-schema';
import { CapabilityUsabilityService } from '../provider-capabilities/capability-usability.service';

export type CapabilityReadinessDimension = 'declared' | 'implemented' | 'authorized' | 'healthy' | 'executable' | 'verifiable';

export interface CapabilityReadinessEvidence {
  capabilityKey: string;
  providerKey: string;
  connectionId: string;
  operation: string;
  riskLevel: string;
  dimensions: Record<CapabilityReadinessDimension, boolean>;
  providerAvailability: string;
  implementation: string;
  grant: string;
  health: string;
  usable: boolean;
  reasons: string[];
}

export interface ScenarioRuntimeEvidence {
  scenarioKey: string;
  scenarioRevision: number;
  evaluatedAt: string;
  availableFacts: string[];
  missingFacts: string[];
  observationPipelineAvailable: boolean;
  executionPipelineAvailable: boolean;
  providerBlocked: boolean;
  manualInputAvailable: boolean;
  capabilities: CapabilityReadinessEvidence[];
  readiness: ScenarioReadiness;
}

/**
 * R1 Readiness Evidence Projector (read-only adapter).
 *
 * Turns real runtime state into the *evidence* inputs that drive
 * `evaluateScenarioReadiness`. It never writes state and never reaches into
 * the Plan / Truth / Execution authoritative chains — it only observes them.
 *
 * Responsibility split:
 *  - Caps (usable capabilities) are computed by the CapabilityUsability path and
 *    passed in by the caller; this service does NOT duplicate the connection walk.
 *  - Observed facts come from candidate facts that reached a decided Truth record
 *    for the user (real fact keys, matching scenario.requiredFacts).
 *  - Observation pipeline availability is evidenced by at least one ingested
 *    source_observation (or live AppRead session) for the user.
 *  - Execution pipeline reflects whether the server execution chain is reachable.
 */
@Injectable()
export class ReadinessEvidenceService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly capabilityUsability: CapabilityUsabilityService,
  ) {}

  async project(userId: string, scenario: ScenarioDefinition, usableCapabilities: string[]): Promise<{ input: ScenarioReadinessInput; evidence: Record<string, unknown> }> {
    // Observed facts: fact keys that reached a decided Truth record for this user.
    const observedFactRows = await this.db.selectDistinct({ factKey: candidateFacts.factKey })
      .from(candidateFacts)
      .where(and(eq(candidateFacts.userId, userId), eq(candidateFacts.status, 'VERIFIED')));

    // Observation pipeline: has the user's data ever reached a source observation sink?
    const observationRows = await this.db.select({ id: sourceObservations.id })
      .from(sourceObservations).where(eq(sourceObservations.userId, userId)).limit(1);

    // Live AppRead session bound to this user also implies an observation conduit is available.
    const sessionRows = await this.db.select({ id: appReadSessions.id })
      .from(appReadSessions).where(eq(appReadSessions.userId, userId)).limit(1);

    // Oracle about a decided truth version supports the observed-fact claim.
    const truthRows = await this.db.select({ id: truthRecords.id })
      .from(truthRecords).where(eq(truthRecords.userId, userId)).limit(1);

    const requiredCapabilities = [...scenario.sourceRequirements, ...scenario.actionRequirements]
      .filter((requirement) => !requirement.optional)
      .map((requirement) => requirement.capabilityKey);
    const providerBlocked = requiredCapabilities.some((capability) => !usableCapabilities.includes(capability));

    const input: ScenarioReadinessInput = {
      usableCapabilities,
      availableFacts: observedFactRows.map((row) => row.factKey),
      manualInputAvailable: scenario.sourceRequirements.some((item) => item.capabilityKey === 'MANUAL_INPUT'),
      observationPipelineAvailable: observationRows.length > 0 || sessionRows.length > 0,
      executionPipelineAvailable: truthRows.length > 0,
      providerBlocked,
    };

    return {
      input,
      evidence: {
        usableCapabilities,
        observedFactCount: input.availableFacts?.length ?? 0,
        hasObservationSource: observationRows.length > 0 || sessionRows.length > 0,
        hasDecidedTruth: truthRows.length > 0,
      },
    };
  }

  /** User-scoped six-dimension capability readiness, aggregated across all connections. */
  async projectCapabilities(userId: string): Promise<CapabilityReadinessEvidence[]> {
    const resolved = await this.resolveConnections(userId);
    const byKey = new Map<string, CapabilityReadinessEvidence>();
    for (const connection of resolved) {
      for (const capability of connection.capabilities) {
        const evidence = this.toCapabilityEvidence(connection.connectionId, connection.providerKey, capability);
        const existing = byKey.get(capability.key);
        // Prefer the first usable projection; otherwise keep the most informative one.
        if (!existing || (evidence.usable && !existing.usable)) byKey.set(capability.key, evidence);
      }
    }
    return [...byKey.values()];
  }

  /** Full user-scoped runtime evidence for one scenario, combining facts + pipelines + capabilities into readiness. */
  async projectScenarioRuntimeEvidence(userId: string, scenario: ScenarioDefinition): Promise<ScenarioRuntimeEvidence> {
    const capabilities = await this.projectCapabilities(userId);
    const usableCapabilities = capabilities.filter((item) => item.usable).map((item) => item.capabilityKey);
    const projected = await this.project(userId, scenario, usableCapabilities);
    const readiness = evaluateScenarioReadiness(scenario, projected.input);
    const requiredCapabilityKeys = new Set([...scenario.sourceRequirements, ...scenario.actionRequirements]
      .filter((requirement) => !requirement.optional)
      .map((requirement) => requirement.capabilityKey));
    return {
      scenarioKey: scenario.key,
      scenarioRevision: scenario.revision,
      evaluatedAt: new Date().toISOString(),
      availableFacts: [...(projected.input.availableFacts ?? [])],
      missingFacts: readiness.missingFacts,
      observationPipelineAvailable: projected.input.observationPipelineAvailable ?? false,
      executionPipelineAvailable: projected.input.executionPipelineAvailable ?? false,
      providerBlocked: projected.input.providerBlocked ?? false,
      manualInputAvailable: projected.input.manualInputAvailable ?? false,
      capabilities: capabilities.filter((item) => requiredCapabilityKeys.has(item.capabilityKey)),
      readiness,
    };
  }

  private async resolveConnections(userId: string) {
    const rows = await this.db.select({ id: connections.id }).from(connections).where(eq(connections.userId, userId));
    return Promise.all(rows.map((row) => this.capabilityUsability.resolveConnection(userId, row.id)));
  }

  private toCapabilityEvidence(connectionId: string, providerKey: string, capability: {
    key: string;
    operation: string;
    riskLevel: string;
    verificationMethods?: string[];
    providerAvailability: string;
    implementation: string;
    grant: string;
    health: string;
    usable: boolean;
    reasons: string[];
  }): CapabilityReadinessEvidence {
    return {
      capabilityKey: capability.key,
      providerKey,
      connectionId,
      operation: capability.operation,
      riskLevel: capability.riskLevel,
      dimensions: {
        declared: capability.providerAvailability === 'AVAILABLE',
        implemented: capability.implementation === 'PRODUCTION' || capability.implementation === 'BETA',
        authorized: capability.grant === 'GRANTED',
        healthy: capability.health === 'HEALTHY',
        executable: capability.usable,
        verifiable: (capability.verificationMethods?.length ?? 0) > 0,
      },
      providerAvailability: capability.providerAvailability,
      implementation: capability.implementation,
      grant: capability.grant,
      health: capability.health,
      usable: capability.usable,
      reasons: capability.reasons,
    };
  }
}
