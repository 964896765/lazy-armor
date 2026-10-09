import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { capabilityInvocations, deviceTasks, executions, reconciliationCases, recurringItemProfiles, runtimeResults, sideEffectOperations, truthRecords, userEventSyncRequests, verificationEvidence } from '@lazy-armor/database';
import { catalogHash, userEventExternalLinkSchema } from '@lazy-armor/plan-schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { RuntimeAuthorityService } from './runtime-authority.service';

/** Source continuation consumes committed reality; it never dispatches a mutation. */
@Injectable()
export class RuntimeSourceContinuationService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly authority: RuntimeAuthorityService) {}

  async consume(userId: string, executionId: string) {
    return this.db.transaction(async tx => {
      const execution = (await tx.select().from(executions).where(and(eq(executions.id, executionId), eq(executions.userId, userId))))[0];
      if (!execution || execution.planId) return false;
      const source = this.authority.sourceFor(execution);
      if (source.kind !== 'USER_EVENT_SYNC') return false;
      await this.authority.assertCurrent(tx, source, execution, 'RECONCILE');
      const request = (await tx.select().from(userEventSyncRequests).where(and(eq(userEventSyncRequests.id, source.requestId), eq(userEventSyncRequests.userId, userId))).for('update'))[0];
      const invocation = (await tx.select().from(capabilityInvocations).where(and(eq(capabilityInvocations.executionId, executionId), eq(capabilityInvocations.userId, userId))))[0];
      if (!invocation) return false;
      if (catalogHash(invocation.resourceScope.authoritySource) !== catalogHash(source)) throw new ConflictException('SOURCE_CONTINUATION_BINDING_MISMATCH');
      const ledger = (await tx.select().from(runtimeResults).where(and(eq(runtimeResults.invocationId, invocation.id), eq(runtimeResults.userId, userId))))[0];
      const operation = (await tx.select().from(sideEffectOperations).where(and(eq(sideEffectOperations.executionId, executionId), eq(sideEffectOperations.userId, userId))))[0];
      if (!ledger || !operation) return false;
      const proof = (await tx.select().from(verificationEvidence).where(and(eq(verificationEvidence.operationId, operation.id), eq(verificationEvidence.userId, userId), eq(verificationEvidence.resultState, 'SUCCEEDED'))).orderBy(desc(verificationEvidence.verifiedAt)).limit(1))[0];
      if (!proof) return false;
      if (ledger.verificationState === 'OUTCOME_UNKNOWN') {
        if (!proof.caseId) return false;
        const resolved = (await tx.select().from(reconciliationCases).where(and(eq(reconciliationCases.id, proof.caseId), eq(reconciliationCases.operationId, operation.id), eq(reconciliationCases.userId, userId), eq(reconciliationCases.status, 'RESOLVED'))))[0];
        if (!resolved) return false;
      } else if (ledger.verificationState !== 'VERIFIED') return false;
      const tasks = await tx.select().from(deviceTasks).where(and(eq(deviceTasks.userId, userId), eq(deviceTasks.status, 'SUCCEEDED'), sql`JSON_UNQUOTE(JSON_EXTRACT(${deviceTasks.payloadJson}, '$.invocationId')) = ${invocation.id}`));
      const task = tasks.find(t => (proof.caseId ? t.payloadJson.reconciliationCaseId === proof.caseId : t.payloadJson.lookupOnly !== true) && Array.isArray(t.payloadJson.verifiedTruthRefs));
      if (!task) return false;
      const truthRefs = task.payloadJson.verifiedTruthRefs as string[];
      if (!truthRefs.length) return false;
      for (const ref of truthRefs) {
        if (!/^truth:[0-9a-f-]{36}$/i.test(ref)) throw new ConflictException('SOURCE_CONTINUATION_TRUTH_INVALID');
        const truth = (await tx.select().from(truthRecords).where(and(eq(truthRecords.id, ref.slice(6)), eq(truthRecords.userId, userId))))[0];
        if (!truth?.currentVersionId || truth.revokedAt) return false;
      }
      const event = (await tx.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.id, source.userEventId), eq(recurringItemProfiles.userId, userId))).for('update'))[0];
      const version = (event.metadataJson as Record<string, unknown>).version;
      const externalId = proof.evidenceJson.deviceOperationId;
      if (typeof externalId !== 'string') throw new ConflictException('SOURCE_CONTINUATION_EXTERNAL_ID_MISSING');
      const deleting=invocation.capabilityId==='calendar.event.delete';
      const link = userEventExternalLinkSchema.parse({schema:'user-event-external-link.v1',id:request.id,userId,userEventId:source.userEventId,policy:'CONFIRM_CHANGES',targetId:invocation.targetId,capabilityId:invocation.capabilityId,externalResourceType:'CalendarEvent',externalResourceId:externalId,lastSyncedUserEventVersion:source.userEventVersion,syncState:deleting?'DELETED':event.status==='cancelled'?'CANCEL_PENDING':event.status==='completed'?'VERIFIED':version!==source.userEventVersion?'CHANGE_PENDING':'VERIFIED',...(deleting?{externalState:'ABSENT'}:{}),lastInvocationId:invocation.id,lastVerificationRef:'verification:'+proof.id,lastSyncedAt:proof.verifiedAt.toISOString()});
      const projection = {schema:'runtime-source-continuation.v1',executionId,ledgerRef:ledger.id,reconciliationCaseId:proof.caseId,truthRefs,link};
      if (catalogHash(request.resultProjectionJson) === catalogHash(projection)) return false;
      await tx.update(userEventSyncRequests).set({resultProjectionJson:projection}).where(eq(userEventSyncRequests.id, request.id));
      return true;
    });
  }

  /** Reuses Outbox recovery, including the Truth-commit-to-continuation crash gap. */
  async recover() {
    const rows = await this.db.selectDistinct({id:executions.id,userId:executions.userId}).from(executions)
      .innerJoin(userEventSyncRequests, sql`JSON_UNQUOTE(JSON_EXTRACT(${executions.authoritySourceJson}, '$.requestId')) = BIN_TO_UUID(${userEventSyncRequests.id})`)
      .innerJoin(capabilityInvocations, eq(capabilityInvocations.executionId, executions.id))
      .innerJoin(runtimeResults, eq(runtimeResults.invocationId, capabilityInvocations.id))
      .innerJoin(sideEffectOperations, eq(sideEffectOperations.executionId, executions.id))
      .innerJoin(verificationEvidence, and(eq(verificationEvidence.operationId, sideEffectOperations.id), eq(verificationEvidence.resultState, 'SUCCEEDED')))
      .where(and(isNull(executions.planId), isNull(userEventSyncRequests.resultProjectionJson))).limit(32);
    let recovered = 0;
    for (const row of rows) if (await this.consume(row.userId,row.id)) recovered++;
    return {recovered};
  }
}
