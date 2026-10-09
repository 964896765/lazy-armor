import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { consumerConversations, consumerMessages, recurringItemProfiles, truthRecords, truthRecordVersions, userEventSyncRequests } from '@lazy-armor/database';
import { catalogHash, confirmedUserEventSyncContractSchema, userEventExternalSyncIntentSchema, userEventInputSchema, type RuntimeAuthoritySource } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';

type Tx = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];

/** Called in the same legal confirmation transaction as USER_EVENT; never creates a Plan. */
@Injectable()
export class UserEventSyncRequestsService {
  constructor(private readonly audit: AuditService) {}

  async createConfirmed(tx: Tx, userId: string, conversationId: string, proposalMessageId: string, userEventId: string, version: number): Promise<RuntimeAuthoritySource> {
    // The legal confirmation caller validates the submitted conversation version and consent.
    const conversation = (await tx.select().from(consumerConversations).where(and(eq(consumerConversations.id, conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).for('update'))[0];
    if (!conversation || conversation.planId || !['ACTIVE', 'USER_EVENT_CONFIRMED'].includes(conversation.status)) throw new ConflictException('SYNC_CONFIRMATION_CONVERSATION_INVALID');
    const latest = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId, conversationId), eq(consumerMessages.role, 'assistant'))).orderBy(desc(consumerMessages.createdAt)).limit(1))[0];
    if (latest?.id !== proposalMessageId) throw new ConflictException('SYNC_CONFIRMATION_PROPOSAL_SUPERSEDED');
    const event = (await tx.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.id, userEventId), eq(recurringItemProfiles.userId, userId), eq(recurringItemProfiles.sourceType, 'user_event'))).for('update'))[0];
    if (!event) throw new NotFoundException('内部事项不存在');
    const m = event.metadataJson as Record<string, unknown>;
    const message = (await tx.select().from(consumerMessages).where(and(eq(consumerMessages.id, proposalMessageId), eq(consumerMessages.conversationId, conversationId), eq(consumerMessages.role, 'assistant'))))[0];
    if (m?.schema !== 'user-event.v1' || m.conversationId !== conversationId || m.proposalMessageId !== proposalMessageId || event.status !== 'active' || m.version !== version
      || message?.structuredPayload?.result !== 'USER_EVENT_DRAFT' || (message.structuredPayload.validationErrors as unknown[] | undefined)?.length) {
      throw new ConflictException('SYNC_CONFIRMATION_AUTHORITY_INVALID');
    }
    const eventParsed = userEventInputSchema.safeParse({ title: event.title, dueAt: m.dueAt, reminderAt: m.reminderAt, timezone: m.timezone });
    const proposalParsed = userEventInputSchema.safeParse(message.structuredPayload.userEvent);
    const intentParsed = userEventExternalSyncIntentSchema.safeParse(message.structuredPayload.externalSync);
    if (!eventParsed.success || !proposalParsed.success || !intentParsed.success) throw new ConflictException('SYNC_CONFIRMATION_CONTRACT_INVALID');
    const eventInput = eventParsed.data, proposalInput = proposalParsed.data, intent = intentParsed.data;
    if (catalogHash(proposalInput) !== catalogHash(eventInput)) throw new ConflictException('SYNC_CONFIRMATION_INPUT_CHANGED');
    const prior = (await tx.select().from(userEventSyncRequests).where(and(eq(userEventSyncRequests.userId, userId), eq(userEventSyncRequests.proposalMessageId, proposalMessageId))).for('update'))[0];
    const proposedRefs = message.structuredPayload.sourceTruthRefs;
    if (proposedRefs != null && (!Array.isArray(proposedRefs) || proposedRefs.length > 30 || proposedRefs.some(ref=>typeof ref!=='string'))) throw new ConflictException('SYNC_SOURCE_REFERENCES_INVALID');
    const sourceTruthRefs: Array<{truthId:string;versionId:string;valueHash:string}> = [];
    for (const truthId of [...new Set((proposedRefs ?? []) as string[])]) {
      const truth = (await tx.select().from(truthRecords).where(and(eq(truthRecords.id,truthId),eq(truthRecords.userId,userId))).for('update'))[0];
      if (!truth?.currentVersionId || truth.status !== 'verified' || truth.revokedAt || !truth.verifiedAt) throw new ConflictException('SYNC_SOURCE_TRUTH_UNAVAILABLE');
      const snapshots=message.structuredPayload.sourceTruthVersions;
      const selected=Array.isArray(snapshots) ? (snapshots as Array<{truthId:string;versionId:string}>).find(ref=>ref.truthId===truthId) : undefined;
      if (!selected || !/^[0-9a-f-]{36}$/i.test(selected.versionId)) throw new ConflictException('SYNC_SOURCE_VERSION_REQUIRED');
      const v=(await tx.select().from(truthRecordVersions).where(and(eq(truthRecordVersions.id,selected.versionId),eq(truthRecordVersions.truthRecordId,truth.id))))[0];
      if (!v || catalogHash(v.valueJson)!==v.valueHash) throw new ConflictException('SYNC_SOURCE_TRUTH_INTEGRITY_ERROR');
      sourceTruthRefs.push({truthId:truth.id,versionId:v.id,valueHash:v.valueHash});
    }
    const contract = confirmedUserEventSyncContractSchema.parse({ schema: 'user-event-sync-confirmation.v1', requestId: prior?.id ?? newId(), ownerId: userId, userEventId, userEventVersion: version, proposalMessageId, userEvent: eventInput, intent, ...(sourceTruthRefs.length ? {sourceTruthRefs} : {}) });
    const contractHash = catalogHash(contract);
    if (prior) {
      if (prior.contractHash !== contractHash || catalogHash(prior.contractJson) !== contractHash || prior.revokedAt) throw new ConflictException('SYNC_CONFIRMATION_REPLAY_CONFLICT');
    } else {
      await tx.insert(userEventSyncRequests).values({ id: contract.requestId, userId, userEventId, userEventVersion: version, proposalMessageId, contractHash, contractJson: contract as unknown as Record<string, unknown>, confirmedAt: new Date(), revokedAt: null });
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'USER_EVENT_SYNC_CONFIRMED', resourceType: 'user_event_sync_request', resourceId: contract.requestId, correlationId: conversationId, source: 'api', result: 'success', changeSummary: 'Confirmed immutable sync request; runtime risk and approval remain required', after: { userEventId, userEventVersion: version, contractHash } }, tx);
    }
    return { kind: 'USER_EVENT_SYNC', ownerId: userId, requestId: contract.requestId, userEventId, userEventVersion: version, contractHash };
  }
}
