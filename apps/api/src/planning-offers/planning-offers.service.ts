import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { connectionCapabilityGrants, connectionPermissions, connections, connectorCapabilities, deviceAppConnections,
  deviceHeartbeats, planCreationContracts, planOfferSnapshots, plans, providerCapabilityHealth, trustedDevices,
  truthProvenance, truthRecords, truthRecordVersions } from '@lazy-armor/database';
import { assessPlanAvailability, buildDeterministicPlanOffer, buildPersistentPlanOffer, canonicalStringify, catalogHash,
  choosePlanOfferRequestSchema, compileScenarioPlan, definitionHash, persistentPlanOfferRequestSchema,
  scenarioContractV2ByKey, type FactDemandProjection, type PersistentPlanOffer } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { RuntimeCatalogRegistryService } from '../runtime-catalog/runtime-catalog-registry.service';
import { ReadinessEvidenceService } from '../runtime-catalog/readiness-evidence.service';
import type { ChoosePersistentPlanOfferDto, CreatePersistentPlanOfferDto, CreatePlanOfferDto } from './dto';
import { FactDemandResolverService } from '../fact-demands/fact-demand-resolver.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { PlansService } from '../plans/plans.service';
import { StrategyRuntimeService } from '../strategy-runtime/strategy-runtime.service';

/**
 * Read-only offer generation. It projects the registered Scenario contract and
 * current user-scoped runtime evidence; it does not create or activate a Plan.
 */
@Injectable()
export class PlanningOffersService {
  constructor(
    private readonly catalog: RuntimeCatalogRegistryService,
    private readonly readiness: ReadinessEvidenceService,
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly factDemands: FactDemandResolverService,
    private readonly plans: PlansService,
    private readonly strategyRuntime: StrategyRuntimeService,
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

  async createPersistent(userId: string, raw: CreatePersistentPlanOfferDto) {
    const request = persistentPlanOfferRequestSchema.parse(raw);
    const contract = scenarioContractV2ByKey(request.scenarioKey);
    if (!contract || contract.scenario.revision !== request.scenarioRevision) throw new NotFoundException('Scenario Contract V2 not available');
    const resolved = await this.factDemands.resolve(userId, request);
    const compiled = this.compile(request, this.catalog.getScenario(request.scenarioKey).defaultStrategy);
    const offer = buildPersistentPlanOffer({ request, demands: resolved.demands, contractHash: contract.definitionHash,
      strategyKey: compiled.strategy, planDefinitionHash: definitionHash(compiled.definition), generatedAt: resolved.evaluatedAt });
    const id = newId();
    const values = { id, userId, offerKey: `${offer.offerKey}:${id}`, scenarioKey: request.scenarioKey,
      scenarioRevision: request.scenarioRevision, contractHash: contract.definitionHash, offerHash: hash(offer),
      preconditionHash: offer.preconditionHash, goalJson: request.goal, subjectJson: request.subject,
      factDemandsJson: resolved.demands as unknown as Record<string, unknown>[],
      sourceResolutionJson: sourceSelections(resolved.demands), offerJson: offer as unknown as Record<string, unknown>,
      status: offer.selectable ? 'AVAILABLE' : 'UNAVAILABLE', expiresAt: new Date(offer.expiresAt),
      chosenAt: null, invalidatedAt: null, createdAt: new Date(offer.generatedAt) };
    try {
      await this.db.insert(planOfferSnapshots).values(values);
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      const existing = await this.findByKey(userId, values.offerKey);
      if (!existing) throw error;
      return this.offerResponse(existing);
    }
    const row = (await this.db.select().from(planOfferSnapshots).where(eq(planOfferSnapshots.id, id)).limit(1))[0];
    return this.offerResponse(row!);
  }

  async choose(userId: string, offerId: string, raw: ChoosePersistentPlanOfferDto) {
    const request = choosePlanOfferRequestSchema.parse(raw);
    const preview = await this.findOwned(userId, offerId);
    const offer = preview.offerJson as unknown as PersistentPlanOffer;
    const factRequest = persistentPlanOfferRequestSchema.parse({ scenarioKey: preview.scenarioKey,
      scenarioRevision: preview.scenarioRevision, goal: preview.goalJson, subject: preview.subjectJson });
    // User-scoped database evidence only; no provider network request is held under the row lock.
    const current = await this.factDemands.resolve(userId, factRequest);
    const compiled = this.compile(factRequest, offer.strategyKey);
    const currentHash = buildPersistentPlanOffer({ request: factRequest, demands: current.demands,
      contractHash: current.contractHash, strategyKey: compiled.strategy,
      planDefinitionHash: definitionHash(compiled.definition), generatedAt: current.evaluatedAt }).preconditionHash;

    const outcome = await this.db.transaction(async (tx) => {
      const priorByKey = (await tx.select().from(planCreationContracts)
        .where(and(eq(planCreationContracts.userId, userId), eq(planCreationContracts.idempotencyKey, request.idempotencyKey))).limit(1))[0];
      if (priorByKey) return { ok: true as const, contract: priorByKey, replayed: true };
      let lockQuery = tx.select().from(planOfferSnapshots)
        .where(and(eq(planOfferSnapshots.id, offerId), eq(planOfferSnapshots.userId, userId))).limit(1);
      if ('for' in lockQuery) lockQuery = lockQuery.for('update') as typeof lockQuery;
      const locked = (await lockQuery)[0];
      if (!locked) return { ok: false as const, code: 'NOT_FOUND' };
      let priorQuery = tx.select().from(planCreationContracts)
        .where(eq(planCreationContracts.offerSnapshotId, offerId)).limit(1);
      if ('for' in priorQuery) priorQuery = priorQuery.for('update') as typeof priorQuery;
      const prior = (await priorQuery)[0];
      if (prior) return { ok: true as const, contract: prior, replayed: true };
      const now = new Date();
      if (locked.status === 'INVALIDATED') return { ok: false as const, code: 'INVALIDATED' };
      if (locked.expiresAt <= now || locked.status === 'EXPIRED') {
        await tx.update(planOfferSnapshots).set({ status: 'EXPIRED', invalidatedAt: now }).where(eq(planOfferSnapshots.id, offerId));
        return { ok: false as const, code: 'EXPIRED' };
      }
      if (locked.status !== 'AVAILABLE') return { ok: false as const, code: 'UNAVAILABLE' };
      const contract = scenarioContractV2ByKey(locked.scenarioKey);
      if (!contract || contract.scenario.revision !== locked.scenarioRevision || contract.definitionHash !== locked.contractHash
        || current.contractHash !== locked.contractHash || currentHash !== locked.preconditionHash
        || definitionHash(compiled.definition) !== (locked.offerJson as unknown as PersistentPlanOffer).planDefinitionHash) {
        await tx.update(planOfferSnapshots).set({ status: 'INVALIDATED', invalidatedAt: now }).where(eq(planOfferSnapshots.id, offerId));
        return { ok: false as const, code: 'PRECONDITIONS_CHANGED' };
      }
      if (!await this.lockAndValidateSelectedSources(tx, userId, current.demands, now)) {
        await tx.update(planOfferSnapshots).set({ status: 'INVALIDATED', invalidatedAt: now }).where(eq(planOfferSnapshots.id, offerId));
        return { ok: false as const, code: 'SOURCE_CHANGED' };
      }
      const created = await this.plans.createInTransaction(userId, compiled.definition, tx);
      await this.strategyRuntime.bindInTransaction(userId, { planVersionId: created.planVersionId,
        scenarioKey: locked.scenarioKey, scenarioRevision: locked.scenarioRevision, strategy: compiled.strategy,
        subjectKey: factRequest.subject.subjectKey }, tx);
      const contractRow = { id: newId(), userId, planId: created.planId, planVersionId: created.planVersionId,
        offerSnapshotId: offerId, idempotencyKey: request.idempotencyKey, scenarioKey: locked.scenarioKey,
        scenarioRevision: locked.scenarioRevision, contractHash: locked.contractHash,
        confirmationHash: catalogHash({ offerHash: locked.offerHash, preconditionHash: currentHash,
          planVersionHash: definitionHash(created.definition), idempotencyKey: request.idempotencyKey }),
        goalJson: locked.goalJson, subjectJson: locked.subjectJson,
        factDemandsJson: current.demands as unknown as Record<string, unknown>[],
        sourceSelectionJson: sourceSelections(current.demands), offerJson: locked.offerJson, createdAt: now };
      await tx.insert(planCreationContracts).values(contractRow);
      await tx.update(planOfferSnapshots).set({ status: 'CHOSEN', chosenAt: now }).where(eq(planOfferSnapshots.id, offerId));
      return { ok: true as const, contract: contractRow, replayed: false };
    });
    if (!outcome.ok) {
      if (outcome.code === 'NOT_FOUND') throw new NotFoundException('Plan Offer not found');
      throw new ConflictException(`Plan Offer cannot be chosen: ${outcome.code}`);
    }
    return { offerId, planId: outcome.contract.planId, planVersionId: outcome.contract.planVersionId,
      creationContractId: outcome.contract.id, replayed: outcome.replayed };
  }

  async planAvailability(userId: string, planId: string) {
    const authority = await this.planCreationAuthority(userId, planId);
    const request = persistentPlanOfferRequestSchema.parse({
      scenarioKey: authority.contract.scenarioKey,
      scenarioRevision: authority.contract.scenarioRevision,
      goal: authority.contract.goalJson,
      subject: authority.contract.subjectJson,
    });
    const current = await this.factDemands.resolve(userId, request);
    const assessment = assessPlanAvailability({
      expectedContractHash: authority.contract.contractHash,
      currentContractHash: current.contractHash,
      previousSelections: jsonArray(authority.contract.sourceSelectionJson),
      currentDemands: current.demands,
      evaluatedAt: current.evaluatedAt,
    });
    return { planId, planVersionId: authority.planVersionId, scenario: current.scenario,
      goal: current.goal, subject: current.subject, assessment, factDemands: current.demands };
  }

  async replan(userId: string, planId: string) {
    const availability = await this.planAvailability(userId, planId);
    if (availability.assessment.state === 'CURRENT') {
      throw new ConflictException('Plan preconditions are current; replacement confirmation is not required');
    }
    const replacement = await this.createPersistent(userId, {
      scenarioKey: availability.scenario.key,
      scenarioRevision: availability.scenario.revision,
      goal: availability.goal,
      subject: availability.subject,
    });
    return { availability: availability.assessment, replacementOffer: replacement };
  }

  private compile(request: ReturnType<typeof persistentPlanOfferRequestSchema.parse>, strategy: string) {
    const name = `${request.subject.displayName ?? request.subject.subjectKey} · ${request.goal.intent}`.slice(0, 120);
    return compileScenarioPlan({ scenarioKey: request.scenarioKey, scenarioRevision: request.scenarioRevision,
      strategy: strategy as never, subjectKey: request.subject.subjectKey, name, mode: 'DRAFT',
      readiness: { manualInputAvailable: true, observationPipelineAvailable: true, executionPipelineAvailable: false } });
  }

  private async findOwned(userId: string, id: string) {
    const row = (await this.db.select().from(planOfferSnapshots)
      .where(and(eq(planOfferSnapshots.id, id), eq(planOfferSnapshots.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('Plan Offer not found');
    return row;
  }
  private async planCreationAuthority(userId: string, planId: string) {
    const plan = (await this.db.select({ currentVersionId: plans.currentVersionId, activeVersionId: plans.activeVersionId })
      .from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))).limit(1))[0];
    if (!plan) throw new NotFoundException('Plan not found');
    const planVersionId = plan.currentVersionId ?? plan.activeVersionId;
    if (!planVersionId) throw new ConflictException('Plan has no versioned creation contract');
    const contract = (await this.db.select().from(planCreationContracts).where(and(
      eq(planCreationContracts.userId, userId), eq(planCreationContracts.planId, planId),
      eq(planCreationContracts.planVersionId, planVersionId),
    )).limit(1))[0];
    if (!contract) throw new ConflictException('Current PlanVersion has no versioned creation contract');
    return { planVersionId, contract };
  }
  private async findByKey(userId: string, offerKey: string) {
    return (await this.db.select().from(planOfferSnapshots)
      .where(and(eq(planOfferSnapshots.userId, userId), eq(planOfferSnapshots.offerKey, offerKey))).limit(1))[0];
  }
  private offerResponse(row: typeof planOfferSnapshots.$inferSelect) {
    return { id: row.id, status: row.status, offer: row.offerJson, expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString() };
  }

  private async lockAndValidateSelectedSources(tx: Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0], userId: string,
    demands: readonly FactDemandProjection[], now: Date) {
    for (const demand of demands) {
      const selection = demand.selectedSource;
      if (!selection) return false;
      if (selection.kind === 'PROVIDER_CONNECTION') {
        const connectionId = selection.connectionId!;
        let query = tx.select().from(connections).where(and(eq(connections.id, connectionId), eq(connections.userId, userId))).limit(1);
        if ('for' in query) query = query.for('update') as typeof query;
        const row = (await query)[0];
        if (!row || row.status !== 'connected' || (row.expiresAt && row.expiresAt <= now)) return false;
        const capabilityKey = selection.capabilityKey;
        if (!capabilityKey) return false;
        let grantQuery = tx.select().from(connectionCapabilityGrants).where(and(eq(connectionCapabilityGrants.connectionId, connectionId),
          eq(connectionCapabilityGrants.capabilityKey, capabilityKey))).limit(1);
        if ('for' in grantQuery) grantQuery = grantQuery.for('update') as typeof grantQuery;
        const grant = (await grantQuery)[0];
        let permissionQuery = tx.select({ permission: connectionPermissions }).from(connectionPermissions)
          .innerJoin(connectorCapabilities, eq(connectionPermissions.connectorCapabilityId, connectorCapabilities.id))
          .where(and(eq(connectionPermissions.connectionId, connectionId), eq(connectorCapabilities.key, capabilityKey))).limit(1);
        if ('for' in permissionQuery) permissionQuery = permissionQuery.for('update') as typeof permissionQuery;
        const permission = (await permissionQuery)[0]?.permission;
        const grantValid = grant?.status === 'GRANTED' && !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now);
        const legacyValid = permission?.granted === 1 && !permission.revokedAt && (!permission.expiresAt || permission.expiresAt > now);
        if (!grantValid && !legacyValid) return false;
        let healthQuery = tx.select().from(providerCapabilityHealth).where(and(eq(providerCapabilityHealth.connectionId, connectionId),
          eq(providerCapabilityHealth.capabilityKey, capabilityKey))).limit(1);
        if ('for' in healthQuery) healthQuery = healthQuery.for('update') as typeof healthQuery;
        const health = (await healthQuery)[0];
        if (health && (health.status !== 'HEALTHY' || (health.validUntil && health.validUntil <= now))) return false;
      } else if (selection.kind === 'TRUSTED_DEVICE') {
        const appId = selection.deviceAppConnectionId!;
        let query = tx.select({ app: deviceAppConnections, device: trustedDevices, heartbeat: deviceHeartbeats })
          .from(deviceAppConnections).innerJoin(trustedDevices, and(eq(deviceAppConnections.trustedDeviceId, trustedDevices.id),
            eq(trustedDevices.userId, userId))).leftJoin(deviceHeartbeats, and(eq(deviceHeartbeats.trustedDeviceId, trustedDevices.id),
            eq(deviceHeartbeats.userId, userId))).where(and(eq(deviceAppConnections.id, appId), eq(deviceAppConnections.userId, userId))).limit(1);
        if ('for' in query) query = query.for('update') as typeof query;
        const row = (await query)[0];
        if (!row || row.device.id !== selection.trustedDeviceId || row.app.enabled !== 1 || !row.app.modesJson.includes('notification_read') || row.device.status !== 'active'
          || row.device.revokedAt || row.heartbeat?.onlineState !== 'online' || !row.heartbeat.lastHeartbeatAt
          || now.getTime() - row.heartbeat.lastHeartbeatAt.getTime() > 30_000) return false;
      } else if (selection.kind === 'MANUAL_INPUT' || selection.kind === 'INTERNAL_FACT') {
        const row = (await tx.select({ record: truthRecords, version: truthRecordVersions, provenance: truthProvenance })
          .from(truthRecords).innerJoin(truthRecordVersions, and(eq(truthRecordVersions.id, selection.truthVersionId!),
            eq(truthRecordVersions.truthRecordId, truthRecords.id)))
          .innerJoin(truthProvenance, eq(truthProvenance.truthRecordVersionId, truthRecordVersions.id))
          .where(and(eq(truthRecords.id, selection.truthRecordId!), eq(truthRecords.userId, userId),
            eq(truthRecords.subjectKey, demand.subject.subjectKey))).limit(1))[0];
        const valueFactKey = row?.version.valueJson.factKey;
        // INTERNAL_FACT means a verified, user-owned Truth Store reference. It
        // may retain FILE / NOTIFICATION / OFFICIAL_API provenance; the current
        // FactDemand has already checked that original source mode against the
        // immutable Scenario Contract. Only MANUAL_INPUT requires MANUAL proof.
        const expectedMode = selection.kind === 'MANUAL_INPUT' ? 'MANUAL' : null;
        if (!row || row.record.currentVersionId !== selection.truthVersionId || row.record.status !== 'verified'
          || row.record.revokedAt || valueFactKey !== demand.factKey || (expectedMode && row.provenance.sourceMode !== expectedMode)
          || now.getTime() - row.version.createdAt.getTime() > demand.maximumAgeSeconds * 1_000) return false;
      } else return false;
    }
    return true;
  }
}

function sourceSelections(demands: readonly FactDemandProjection[]) {
  return demands.map((demand) => ({ demandId: demand.demandId, factKey: demand.factKey,
    subjectKey: demand.subject.subjectKey, selectedSourceId: demand.selectedSourceId, selectedSource: demand.selectedSource,
    maximumAgeSeconds: demand.maximumAgeSeconds, verificationRequirements: demand.verificationRequirements,
    truthEvidence: demand.truthEvidence.map((truth) => ({ truthRecordId: truth.truthRecordId,
      truthVersionId: truth.truthVersionId, valueHash: truth.valueHash, observedAt: truth.observedAt })),
    state: demand.state, reasonCodes: demand.reasonCodes }));
}
function jsonArray(value: unknown): Array<{ demandId: string; selectedSourceId?: string | null; selectedSource?: import('@lazy-armor/plan-schema').SourceSelection | null }> {
  if (Array.isArray(value)) return value as Array<{ demandId: string; selectedSourceId?: string | null; selectedSource?: import('@lazy-armor/plan-schema').SourceSelection | null }>;
  if (typeof value === 'string') { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) return parsed as ReturnType<typeof jsonArray>; }
  throw new ConflictException('Persisted source selection contract is invalid');
}
function hash(value: unknown) { return createHash('sha256').update(canonicalStringify(value)).digest('hex'); }
function isDuplicate(error: unknown) { let current = error; for (let index = 0; index < 5 && current && typeof current === 'object'; index += 1) {
  const item = current as { code?: string; cause?: unknown }; if (item.code === 'ER_DUP_ENTRY') return true; current = item.cause; } return false; }
