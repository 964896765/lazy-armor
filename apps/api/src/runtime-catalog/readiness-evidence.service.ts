import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { connections, truthRecords, truthRecordVersions, sourceObservations, appReadSessions, deviceHeartbeats, trustedDevices, executions, plans, strategyRuntimeBindings } from '@lazy-armor/database';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { APP_READ_SESSION_HEARTBEAT_GRACE_SECONDS, evaluateScenarioReadiness, type ScenarioDefinition, type ScenarioReadiness, type ScenarioReadinessInput } from '@lazy-armor/plan-schema';
import { CapabilityUsabilityService } from '../provider-capabilities/capability-usability.service';
import { ProviderCapabilityRegistryService } from '../provider-capabilities/provider-capability-registry.service';
import { projectConsumerReadiness, type ConsumerReadinessProjection } from './readiness-product-projection';
import { projectScenarioFacts } from './scenario-fact-projection';

export type CapabilityReadinessDimension = 'declared' | 'implemented' | 'authorized' | 'healthy' | 'executable' | 'verifiable';

export interface CapabilityReadinessEvidence {
  capabilityKey: string;
  providerKey: string;
  connectionId: string;
  operation: string;
  sourceModes: string[];
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
  product: ConsumerReadinessProjection;
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
 *  - Available facts come only from the current, non-revoked Truth version
 *    within the scenario freshness window.
 *  - Observation availability requires a recent observation or live AppRead heartbeat.
 *  - Execution evidence requires a successful run of the active scenario plan version, not merely a Truth.
 */
@Injectable()
export class ReadinessEvidenceService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly capabilityUsability: CapabilityUsabilityService,
    private readonly manifests: ProviderCapabilityRegistryService,
  ) {}

  async project(userId: string, scenario: ScenarioDefinition, usableCapabilities: string[]): Promise<{ input: ScenarioReadinessInput; evidence: Record<string, unknown> }> {
    // Current, non-revoked Truth versions only. Historical verified candidates do not prove a usable fact.
    const now = new Date();
    const freshAfter = new Date(now.getTime() - scenario.freshnessPolicy.maximumAgeSeconds * 1000);
    const currentTruth = await this.db.select({ value: truthRecordVersions.valueJson, createdAt: truthRecordVersions.createdAt })
      .from(truthRecords)
      .innerJoin(truthRecordVersions, eq(truthRecords.currentVersionId, truthRecordVersions.id))
      .where(and(eq(truthRecords.userId, userId), eq(truthRecords.status, 'verified'), isNull(truthRecords.revokedAt)));
    const factProjection = projectScenarioFacts(scenario.requiredFacts, currentTruth, freshAfter);
    const { availableFacts } = factProjection;

    // Observation pipeline: a recent source observation or an active read session.
    const observationRows = await this.db.select({ id: sourceObservations.id })
      .from(sourceObservations).where(and(eq(sourceObservations.userId, userId), gt(sourceObservations.observedAt, freshAfter))).limit(1);

    // Live AppRead session bound to this user also implies an observation conduit is available.
    const sessionHeartbeatAfter = new Date(now.getTime() - APP_READ_SESSION_HEARTBEAT_GRACE_SECONDS * 1000);
    const sessionRows = await this.db.select({ id: appReadSessions.id })
      .from(appReadSessions)
      .innerJoin(trustedDevices, and(eq(appReadSessions.trustedDeviceId, trustedDevices.id), eq(trustedDevices.status, 'active'), isNull(trustedDevices.revokedAt)))
      .where(and(eq(appReadSessions.userId, userId), eq(trustedDevices.userId, userId), eq(appReadSessions.status, 'READING'),
        gt(appReadSessions.expiresAt, now), gt(appReadSessions.lastHeartbeatAt, sessionHeartbeatAfter))).limit(1);

    const executionRows = await this.db.select({ id: executions.id })
      .from(strategyRuntimeBindings)
      .innerJoin(executions, eq(executions.planVersionId, strategyRuntimeBindings.planVersionId))
      .innerJoin(plans, and(eq(plans.activeVersionId, strategyRuntimeBindings.planVersionId), eq(plans.status, 'active')))
      .where(and(eq(strategyRuntimeBindings.userId, userId), eq(strategyRuntimeBindings.scenarioKey, scenario.key),
        eq(plans.userId, userId), eq(executions.userId, userId), eq(executions.status, 'succeeded'))).limit(1);

    const requiredCapabilities = [...scenario.sourceRequirements, ...scenario.actionRequirements]
      .filter((requirement) => !requirement.optional)
      .map((requirement) => requirement.capabilityKey);
    const providerBlocked = requiredCapabilities.some((capability) => !usableCapabilities.includes(capability));

    const input: ScenarioReadinessInput = {
      usableCapabilities,
      availableFacts,
      manualInputAvailable: scenario.sourceRequirements.some((item) => item.capabilityKey === 'MANUAL_INPUT'),
      observationPipelineAvailable: observationRows.length > 0 || sessionRows.length > 0,
      executionPipelineAvailable: executionRows.length > 0,
      providerBlocked,
    };

    return {
      input,
      evidence: {
        usableCapabilities,
        observedFactCount: input.availableFacts?.length ?? 0,
        hasObservationSource: observationRows.length > 0 || sessionRows.length > 0,
        hasDecidedTruth: factProjection.hasDecidedTruth,
        hasSuccessfulScenarioExecution: executionRows.length > 0,
        staleFactCount: factProjection.staleFactCount,
      },
    };
  }

  /** User-scoped six-dimension capability readiness, aggregated across all connections. */
  async projectCapabilities(userId: string): Promise<CapabilityReadinessEvidence[]> {
    const candidates = await this.projectCapabilityCandidates(userId);
    const byKey = new Map<string, CapabilityReadinessEvidence>();
    for (const evidence of candidates) {
      const existing = byKey.get(evidence.capabilityKey);
      // Prefer the first usable projection; otherwise keep the most informative one.
      if (!existing || (evidence.usable && !existing.usable)) byKey.set(evidence.capabilityKey, evidence);
    }
    return [...byKey.values()];
  }

  /** All owned connection candidates, without collapsing fallback providers by capability key. */
  async projectCapabilityCandidates(userId: string): Promise<CapabilityReadinessEvidence[]> {
    const resolved = await this.resolveConnections(userId);
    return resolved.flatMap((connection) => connection.capabilities
      .map((capability) => this.toCapabilityEvidence(connection.connectionId, connection.providerKey, capability)));
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
    const requiredKeys = [...requiredCapabilityKeys];
    const declared = this.manifests.list().flatMap((manifest) => manifest.capabilities);
    const platformSupported = requiredKeys.every((key) => key === 'SEND_NOTIFICATION' || declared.some((capability) => capability.key === key
      && capability.officialAvailability === 'AVAILABLE'
      && (capability.implementationStatus === 'PRODUCTION' || capability.implementationStatus === 'BETA')));
    const now = new Date();
    const deviceRows = await this.db.select({ lastHeartbeatAt: deviceHeartbeats.lastHeartbeatAt, onlineState: deviceHeartbeats.onlineState })
      .from(deviceHeartbeats)
      .innerJoin(trustedDevices, and(eq(deviceHeartbeats.trustedDeviceId, trustedDevices.id), eq(trustedDevices.status, 'active'), isNull(trustedDevices.revokedAt)))
      .where(and(eq(deviceHeartbeats.userId, userId), eq(trustedDevices.userId, userId)));
    const deviceOnline = deviceRows.some((row) => row.onlineState === 'online' && now.getTime() - row.lastHeartbeatAt.getTime() <= 30_000);
    const product = projectConsumerReadiness({
      readiness, capabilities: capabilities.filter((item) => requiredCapabilityKeys.has(item.capabilityKey)),
      platformSupported, deviceRequired: scenario.sourceRequirements.some((item) => item.capabilityKey.startsWith('DEVICE_')),
      deviceOnline,
    });
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
      product,
    };
  }

  private async resolveConnections(userId: string) {
    const rows = await this.db.select({ id: connections.id }).from(connections).where(eq(connections.userId, userId));
    return Promise.all(rows.map((row) => this.capabilityUsability.resolveConnection(userId, row.id)));
  }

  private toCapabilityEvidence(connectionId: string, providerKey: string, capability: {
    key: string;
    operation: string;
    sourceModes?: string[];
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
      sourceModes: [...(capability.sourceModes ?? [])],
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
