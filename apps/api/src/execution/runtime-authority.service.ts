import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { plans, planVersions, recurringItemProfiles, userEventSyncRequests, capabilityInvocations, verificationEvidence, runtimeTargets } from '@lazy-armor/database';
import { assertRuntimeAuthorityBinding, catalogHash, confirmedUserEventSyncContractSchema, runtimeAuthoritySourceSchema, userEventInputSchema, normalizePlanDefinition, definitionHash, prepareAndroidCalendarCreate, prepareAndroidCalendarUpdate, prepareAndroidCalendarDelete, userEventExternalLinkSchema, type RuntimeAuthoritySource, type ConfirmedUserEventSyncContract, type PlanDefinition } from '@lazy-armor/plan-schema';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

type Tx = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];
export type AuthorityOperation = 'WRITE' | 'RECONCILE';

/** Reuses the normalized execution contract, without creating Plan/PlanVersion records. */
export function compileUserEventSyncDefinition(contract: ConfirmedUserEventSyncContract, calendarId: string): PlanDefinition {
  if (contract.schema === 'user-event-sync-confirmation.v2' && calendarId !== contract.externalIdentity.calendarId) throw new ConflictException('SYNC_MUTATION_CALENDAR_SCOPE_MISMATCH');
  const event = prepareAndroidCalendarCreate({ calendarId, title: contract.userEvent.title,
    start: { dateTime: contract.userEvent.dueAt, timeZone: contract.userEvent.timezone },
    end: { dateTime: new Date(Date.parse(contract.userEvent.dueAt) + contract.intent.durationMinutes * 60_000).toISOString(), timeZone: contract.userEvent.timezone }, attendees: [], sendUpdates: 'none' });
  let config: Record<string, unknown> = { visibility: 'private', calendarEvent: event };
  let capability = 'calendar.event.create';
  if (contract.schema === 'user-event-sync-confirmation.v2') {
    const identity = {calendarId, eventId:contract.externalIdentity.externalEventId, expectedOperationMarker:contract.externalIdentity.operationMarker};
    capability = contract.operation === 'UPDATE' ? 'calendar.event.update' : 'calendar.event.delete';
    config = {visibility:'private',calendarMutation:contract.operation === 'UPDATE' ? prepareAndroidCalendarUpdate({...event,...identity}) : prepareAndroidCalendarDelete(identity)};
  }
  return normalizePlanDefinition({ name: contract.userEvent.title, domain: 'general', automationLevel: 'L2', approvalPolicy: { type: 'always' }, sources: [{sourceType:'manual',config:{},sortOrder:0}], triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [], actions: [{ actionType: 'publish', requiredCapability: capability, config, stepOrder: 0 }] });
}

/** Common authority gate for the existing Runtime. Permission and lease gates remain separate. */
@Injectable()
export class RuntimeAuthorityService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  sourceFor(execution: { userId: string; planId: string | null; planVersionId: string | null; authoritySourceJson?: Record<string, unknown> | null }): RuntimeAuthoritySource {
    if (execution.authoritySourceJson) return assertRuntimeAuthorityBinding(runtimeAuthoritySourceSchema.parse(execution.authoritySourceJson), execution);
    if (!execution.planId || !execution.planVersionId) throw new ConflictException('RUNTIME_AUTHORITY_SOURCE_REQUIRED');
    return { kind: 'PLAN', ownerId: execution.userId, planId: execution.planId, planVersionId: execution.planVersionId };
  }

  async assertExecution(execution: { userId: string; planId: string | null; planVersionId: string | null; authoritySourceJson?: Record<string, unknown> | null }, operation: AuthorityOperation = 'WRITE') {
    return this.db.transaction(tx => this.assertCurrent(tx, this.sourceFor(execution), execution, operation));
  }

  async loadSyncDefinition(execution: { userId: string; planId: string | null; planVersionId: string | null; authoritySourceJson?: Record<string, unknown> | null; definitionSnapshotJson?: Record<string, unknown> | null; definitionHash: string }, tx?: Tx) {
    const { contract } = tx ? await this.assertCurrent(tx, this.sourceFor(execution), execution) : await this.assertExecution(execution);
    if (!contract || !execution.definitionSnapshotJson) throw new ConflictException('RUNTIME_DEFINITION_SNAPSHOT_REQUIRED');
    const actions = execution.definitionSnapshotJson.actions as Array<{ config?: { calendarEvent?: { calendarId?: string }; calendarMutation?: {calendarId?:string} } }> | undefined;
    const calendarId = actions?.[0]?.config?.calendarEvent?.calendarId ?? actions?.[0]?.config?.calendarMutation?.calendarId;
    if (!calendarId) throw new ConflictException('RUNTIME_DEFINITION_SCOPE_REQUIRED');
    const definition = compileUserEventSyncDefinition(contract, calendarId);
    if (definitionHash(definition) !== execution.definitionHash || catalogHash(definition) !== catalogHash(execution.definitionSnapshotJson)) throw new ConflictException('RUNTIME_DEFINITION_INTEGRITY_ERROR');
    return definition;
  }

  async assertCurrent(tx: Tx, sourceInput: RuntimeAuthoritySource, binding: {
    userId: string; planId: string | null; planVersionId: string | null;
  }, operation: AuthorityOperation = 'WRITE') {
    let source: RuntimeAuthoritySource;
    try { source = assertRuntimeAuthorityBinding(runtimeAuthoritySourceSchema.parse(sourceInput), binding); }
    catch { throw new ConflictException('RUNTIME_AUTHORITY_BINDING_INVALID'); }
    if (source.kind === 'PLAN') {
      const plan = (await tx.select().from(plans).where(and(eq(plans.id, source.planId), eq(plans.userId, binding.userId))).for('update'))[0];
      const version = (await tx.select().from(planVersions).where(and(eq(planVersions.id, source.planVersionId), eq(planVersions.planId, source.planId))))[0];
      // Existing Plan dispatch contract stays strict, including lookup-only recovery.
      if (!plan || !version || plan.status !== 'active' || plan.activeVersionId !== version.id) throw new ConflictException('Native write PlanVersion no longer active');
      return { source, contract: null };
    }
    const request = (await tx.select().from(userEventSyncRequests).where(and(eq(userEventSyncRequests.id, source.requestId), eq(userEventSyncRequests.userId, binding.userId))).for('update'))[0];
    if (!request) throw new NotFoundException('Confirmed sync authority not found');
    const parsed = confirmedUserEventSyncContractSchema.safeParse(request.contractJson);
    if (!parsed.success) throw new ConflictException('SYNC_AUTHORITY_CONTRACT_INVALID');
    const contract = parsed.data;
    if (request.contractHash !== source.contractHash || catalogHash(contract) !== request.contractHash
      || contract.requestId !== request.id || contract.ownerId !== request.userId
      || contract.userEventId !== request.userEventId || contract.userEventVersion !== request.userEventVersion
      || contract.proposalMessageId !== request.proposalMessageId
      || source.userEventId !== request.userEventId || source.userEventVersion !== request.userEventVersion) {
      throw new ConflictException('SYNC_AUTHORITY_CONTRACT_MISMATCH');
    }
    const event = (await tx.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.id, source.userEventId), eq(recurringItemProfiles.userId, binding.userId), eq(recurringItemProfiles.sourceType, 'user_event'))).for('update'))[0];
    if (!event) throw new NotFoundException('Sync personal item not found');
    const m = event.metadataJson as Record<string, unknown>;
    if (m?.schema !== 'user-event.v1') throw new ConflictException('SYNC_USER_EVENT_CONTRACT_INVALID');
    if (contract.schema === 'user-event-sync-confirmation.v2') {
      const identity=contract.externalIdentity;
      const prior=(await tx.select().from(userEventSyncRequests).where(and(eq(userEventSyncRequests.id,identity.previousRequestId),eq(userEventSyncRequests.userId,binding.userId),eq(userEventSyncRequests.userEventId,event.id))))[0];
      const link=userEventExternalLinkSchema.safeParse(prior?.resultProjectionJson?.link);
      const invocation=link.success && link.data.lastInvocationId ? (await tx.select().from(capabilityInvocations).where(and(eq(capabilityInvocations.id,link.data.lastInvocationId),eq(capabilityInvocations.userId,binding.userId))))[0] : null;
      const proof=(await tx.select().from(verificationEvidence).where(and(eq(verificationEvidence.id,identity.verificationRef.slice(13)),eq(verificationEvidence.userId,binding.userId),eq(verificationEvidence.resultState,'SUCCEEDED'))))[0];
      const evidence=proof?.evidenceJson.evidence as Record<string,unknown>|undefined;
      const target=(await tx.select().from(runtimeTargets).where(and(eq(runtimeTargets.id,identity.targetId),eq(runtimeTargets.userId,binding.userId))))[0];
      if (!link.success || !invocation || !proof || link.data.userId!==binding.userId || link.data.userEventId!==event.id || link.data.id!==identity.previousRequestId || link.data.targetId!==identity.targetId || link.data.externalResourceId!==identity.externalEventId
        || link.data.lastSyncedUserEventVersion!==identity.syncedUserEventVersion || link.data.lastVerificationRef!==identity.verificationRef
        || link.data.externalState==='ABSENT' || target?.backingRef!==identity.trustedDeviceId
        || invocation.targetId!==identity.targetId || evidence?.calendarId!==identity.calendarId || evidence?.eventId!==identity.externalEventId || evidence?.operationMarker!==identity.operationMarker) throw new ConflictException('SYNC_MUTATION_VERIFIED_IDENTITY_MISMATCH');
    }
    // Lookup reconciles the immutable original request even after an internal edit/cancel.
    // This permission is read-only and cannot authorize another create.
    if (operation === 'WRITE') {
      const expectedStatus=contract.schema==='user-event-sync-confirmation.v2'&&contract.operation==='DELETE'?'cancelled':'active';
      if (request.revokedAt || event.status !== expectedStatus || m.version !== source.userEventVersion) throw new ConflictException('SYNC_AUTHORITY_SUPERSEDED_OR_REVOKED');
      const current = userEventInputSchema.safeParse({ title: event.title, dueAt: m.dueAt, reminderAt: m.reminderAt, timezone: m.timezone });
      if (!current.success || catalogHash(current.data) !== catalogHash(contract.userEvent)) throw new ConflictException('SYNC_USER_EVENT_SNAPSHOT_MISMATCH');
    }
    return { source, contract };
  }

  async assertPlan(tx: Tx, userId: string, planId: string, planVersionId: string) {
    return this.assertCurrent(tx, { kind: 'PLAN', ownerId: userId, planId, planVersionId }, { userId, planId, planVersionId });
  }
}
