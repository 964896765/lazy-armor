import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { appReadSessions, candidateFacts, consumerConversations, deviceAppConnections, deviceTasks, readEvidence, sourceObservations, trustedDevices, truthProvenance, truthRecords, truthRecordVersions } from '@lazy-armor/database';
import { realityValueHash, type GoalPageReadResult } from '@lazy-armor/plan-schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AppReadSessionsService } from '../app-read-sessions/app-read-sessions.service';
import { assertGoalPageReadCurrent, goalPageSessionId, savedGoalPageRead } from '../app-read-sessions/goal-page-read-authority';
import { assertUiReadCapability, frozenUiReadConsent } from '../app-read-sessions/ui-read-consent';
import { resolveUiReadProfile } from '../structured-read/app-read-profiles';
import type { ConfirmGoalPageReadDto } from './goal-page-read.dto';

@Injectable()
export class GoalPageReadService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly sessions: AppReadSessionsService) {}

  async sources(userId: string) {
    return this.db.select().from(deviceAppConnections).where(and(eq(deviceAppConnections.userId, userId), eq(deviceAppConnections.packageName, 'com.miui.calculator')));
  }

  async confirm(userId: string, conversationId: string, messageId: string, input: ConfirmGoalPageReadDto, trustedDeviceId: string) {
    if (!input.confirmed) throw new BadRequestException('请先确认本次应用与读取范围');
    const saved = await savedGoalPageRead(this.db, userId, { conversationId, messageId, conversationVersion: input.version });
    const profile = resolveUiReadProfile(saved.proposal.packageName)!;
    return this.sessions.create(userId, { connectionId: input.connectionId, targetPackage: profile.packageName, modes: ['UI_READ'], durationSeconds: 300,
      uiReadConsent: { version: 'ui-read.v1', requestedFields: [...profile.allowedSelectors] } }, trustedDeviceId, saved.frozen);
  }

  /** Publish a derived card from the existing frozen consent, Task and exact candidate lineage. */
  async results(userId: string, conversationId: string, messageIds: string[]): Promise<GoalPageReadResult[]> {
    if (!(await this.db.select({ id: consumerConversations.id }).from(consumerConversations).where(and(eq(consumerConversations.id, conversationId),
      eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).limit(1))[0]) throw new NotFoundException('会话不存在');
    const results: GoalPageReadResult[] = [];
    for (const messageId of messageIds) {
      const sessionId = goalPageSessionId(userId, messageId);
      const consent = await frozenUiReadConsent(this.db, userId, sessionId);
      if (!consent?.goal || consent.goal.conversationId !== conversationId || consent.goal.messageId !== messageId) continue;
      const card: GoalPageReadResult = { sessionId, messageId, conversationVersion: consent.goal.conversationVersion, deviceTaskId: null, status: 'CONFIRMED', candidates: [], verified: [] };
      const task = (await this.db.select().from(deviceTasks).where(and(eq(deviceTasks.userId, userId), eq(deviceTasks.taskType, 'APP_STRUCTURED_READ'),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${deviceTasks.payloadJson}, '$.appReadSessionId')) = ${sessionId}`,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${deviceTasks.payloadJson}, '$.requestId')) = ${'goal-page-' + sessionId}`)).limit(1))[0];
      card.deviceTaskId = task?.id ?? null;
      try { await assertGoalPageReadCurrent(this.db, userId, consent.goal); }
      catch { card.status = 'SUPERSEDED'; results.push(card); continue; }
      const session = (await this.db.select().from(appReadSessions).where(and(eq(appReadSessions.id, sessionId), eq(appReadSessions.userId, userId))).limit(1))[0];
      const source = session && (await this.db.select().from(deviceAppConnections).where(and(eq(deviceAppConnections.id, session.deviceAppConnectionId), eq(deviceAppConnections.userId, userId))).limit(1))[0];
      try {
        const device = session && (await this.db.select().from(trustedDevices).where(and(eq(trustedDevices.id, session.trustedDeviceId), eq(trustedDevices.userId, userId))).limit(1))[0];
        if (!session || !source?.enabled || !source.launchable || source.updatedAt.toISOString() !== consent.sourceVersion
          || session.terminalReason === 'UI_READ_AUTHORITY_CHANGED' || !device || device.status !== 'active' || device.revokedAt) throw new Error('source changed');
        await assertUiReadCapability(this.db, userId, session.trustedDeviceId);
      } catch { card.status = 'SOURCE_UNAVAILABLE'; results.push(card); continue; }
      const delivered = task?.status === 'FAILED' && task.errorCode === 'NEEDS_CONFIRMATION' && !!task.resultJson && !!task.resultHash
        && realityValueHash(task.resultJson) === task.resultHash && task.resultJson.screenId === sessionId
        && task.resultJson.packageName === session!.targetPackage && task.resultJson.resourceId === sessionId;
      const evidence = delivered && (await this.db.select().from(readEvidence).where(and(eq(readEvidence.userId, userId), eq(readEvidence.requestId, 'goal-page-' + sessionId),
        eq(readEvidence.resourceId, sessionId), eq(readEvidence.sourceType, 'DEVICE_APP'), eq(readEvidence.readMethod, 'ANDROID_STRUCTURED'))).limit(1))[0];
      const ids = evidence ? evidence.candidateIdsJson ?? [] : [];
      for (const id of ids) {
        const row = (await this.db.select({ candidate: candidateFacts, observation: sourceObservations }).from(candidateFacts)
          .innerJoin(sourceObservations, eq(candidateFacts.observationId, sourceObservations.id))
          .where(and(eq(candidateFacts.id, id), eq(candidateFacts.userId, userId), eq(sourceObservations.userId, userId))).limit(1))[0];
        if (!row || !evidence || row.observation.id !== evidence.observationId || row.observation.providerKey !== 'edge-device'
          || row.observation.externalEventKey !== 'structured-read:goal-page-' + sessionId || row.observation.evidenceHash !== evidence.evidenceHash) continue;
        card.candidates.push({ id, status: row.candidate.status });
        if (row.candidate.status !== 'VERIFIED' || !row.candidate.truthRecordId) continue;
        const proof = (await this.db.select({ truth: truthRecords, version: truthRecordVersions }).from(truthRecords)
          .innerJoin(truthRecordVersions, eq(truthRecords.currentVersionId, truthRecordVersions.id)).where(and(eq(truthRecords.id, row.candidate.truthRecordId),
            eq(truthRecords.userId, userId), eq(truthRecords.status, 'verified'), isNull(truthRecords.revokedAt))).limit(1))[0];
        const value = proof?.version.valueJson as { value?: Record<string, unknown> } | undefined;
        const observedValue = row.candidate.valueJson;
        const provenance = proof && (await this.db.select({ id: truthProvenance.id }).from(truthProvenance).where(and(eq(truthProvenance.truthRecordVersionId, proof.version.id),
          eq(truthProvenance.candidateFactId, row.candidate.id), eq(truthProvenance.observationId, row.observation.id), eq(truthProvenance.evidenceHash, row.observation.evidenceHash))).limit(1))[0];
        if (proof && proof.version.truthRecordId === proof.truth.id && proof.truth.subjectKey === row.candidate.subjectKey
          && provenance
          && proof.truth.resourceKey === (row.candidate.compatibilityResourceKey ?? row.candidate.resourceType)
          && value?.value && realityValueHash(value.value) === row.candidate.valueHash
          && proof.version.evidenceHash === row.observation.evidenceHash && ['string', 'number', 'boolean'].includes(typeof observedValue.value)) card.verified.push({ truthId: proof.truth.id,
            versionId: proof.version.id, value: String(observedValue.value), observedAt: row.observation.observedAt.toISOString() });
      }
      card.status = card.candidates.length ? card.verified.length === card.candidates.length ? 'VERIFIED'
        : card.candidates.every(c => c.status === 'REJECTED') ? 'REJECTED' : 'NEEDS_CONFIRMATION'
        : task?.status === 'FAILED' || ['CANCELLED', 'FAILED', 'TIMEOUT', 'APP_LEFT_FOREGROUND'].includes(session!.status) ? 'FAILED' : task ? 'READING' : 'CONFIRMED';
      if (card.candidates.some(c => c.status === 'VERIFIED') && card.verified.length === 0) { card.status = 'SOURCE_UNAVAILABLE'; card.candidates = []; }
      // Recheck the target and authority after materializing the card. New facts never replace an old goal's answer.
      try {
        await assertGoalPageReadCurrent(this.db, userId, consent.goal);
        const currentSource = (await this.db.select().from(deviceAppConnections).where(eq(deviceAppConnections.id, source!.id)).limit(1))[0];
        if (!currentSource?.enabled || currentSource.updatedAt.toISOString() !== consent.sourceVersion) throw new Error('source changed');
        const currentSession = (await this.db.select().from(appReadSessions).where(eq(appReadSessions.id, sessionId)).limit(1))[0];
        const currentDevice = (await this.db.select().from(trustedDevices).where(and(eq(trustedDevices.id, session!.trustedDeviceId), eq(trustedDevices.userId, userId))).limit(1))[0];
        if (!currentSession || currentSession.terminalReason === 'UI_READ_AUTHORITY_CHANGED' || !currentDevice || currentDevice.status !== 'active' || currentDevice.revokedAt) throw new Error('authority changed');
        await assertUiReadCapability(this.db, userId, session!.trustedDeviceId);
        for (const item of card.verified) {
          const truth = (await this.db.select().from(truthRecords).where(and(eq(truthRecords.id, item.truthId), eq(truthRecords.userId, userId))).limit(1))[0];
          if (!truth || truth.status !== 'verified' || truth.revokedAt || truth.currentVersionId !== item.versionId) throw new Error('truth changed');
        }
      } catch { card.status = 'SOURCE_UNAVAILABLE'; card.verified = []; card.candidates = []; }
      results.push(card);
    }
    return results;
  }
}
