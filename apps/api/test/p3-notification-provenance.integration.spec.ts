import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDatabase, users, trustedDevices, deviceAppConnections, localCapabilityStates, runtimeTargets, mobileNotificationReceipts,
  plans, planVersions, planOfferSnapshots, planCreationContracts, strategyRuntimeBindings, truthFactDependencies, strategyRuntimeWakeups, strategyRuntimeDecisions,
  truthProvenance, sourceObservations, appReadSessions, appReadSessionEvents, truthRecords, truthRecordVersions, deviceTasks, executions, notifications,
} from '@lazy-armor/database';
import { catalogHash, compileNotificationWatchAuthoring, realityValueHash } from '@lazy-armor/plan-schema';
import { and, eq } from 'drizzle-orm';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';
import { TruthHandoffGuard, type TruthHandoffProof } from '../src/strategy-runtime/truth-handoff-guard.service';
import { ActionExecutor } from '../src/execution/action-executor.service';
import { lockNotificationReceiptSource, lockNotificationSource, nativeNotificationReceiptPayloadHash, nativeNotificationReceiptEventEvidenceHash, type NotificationSourceBinding } from '../src/strategy-runtime/notification-receipt-source.guard';

/** Isolated database fixtures and real normalizer/guard paths, never phone evidence. */
describe.sequential('P3 confirmed notification receipt provenance and source authority', { timeout: 60_000 }, () => {
  let bundle: ReturnType<typeof createDatabase>;
  let guard: TruthHandoffGuard;
  let receipt: typeof mobileNotificationReceipts.$inferSelect;
  let proof: TruthHandoffProof;
  let binding: NotificationSourceBinding;
  let nativeItem: Record<string, unknown>;
  let truthId: string, truthVersionId: string, observationId: string, provenanceId: string;
  const owner = randomUUID(), stranger = randomUUID(), deviceId = randomUUID(), appId = randomUUID(), targetId = randomUUID();
  const planId = randomUUID(), versionId = randomUUID(), runtimeId = randomUUID(), wakeupId = randomUUID(), contractId = randomUUID();
  const sourcePackage = 'com.jingdong.app.mall', now = new Date();
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

  beforeAll(async () => {
    const url = process.env.DATABASE_URL!;
    if (!new URL(url).pathname.toLowerCase().includes('test')) throw new Error('Notification provenance requires an isolated test database');
    bundle = createDatabase(url); const db = bundle.db;
    await db.insert(users).values([owner, stranger].map(id => ({ id, status: 'active', role: 'user', createdAt: now, updatedAt: now })));
    await db.insert(trustedDevices).values({ id: deviceId, userId: owner, deviceId: 'notification-provenance-' + deviceId, keyId: deviceId, publicKeySpki: 'isolated-guard-fixture', publicKeyFingerprint: hash(deviceId), trustLevel: 'DEVICE_KEY_PROOF', status: 'active', lastProvedAt: now, revokedAt: null, createdAt: now, updatedAt: now });
    await db.insert(deviceAppConnections).values({ id: appId, userId: owner, deviceId: 'notification-provenance-' + deviceId, trustedDeviceId: deviceId, packageName: sourcePackage, displayName: 'JD isolated provenance fixture', connectionType: 'generic', enabled: 1, launchable: 1, modesJson: ['notification_read'], trustLevel: 'DEVICE_KEY_PROOF', lastSeenAt: now, createdAt: now, updatedAt: now });
    await db.insert(localCapabilityStates).values({ id: randomUUID(), userId: owner, trustedDeviceId: deviceId, capability: 'notification.read', manifestVersion: 'android-local-v4', userGrant: true, systemPermission: 'GRANTED', health: 'HEALTHY', checkedAt: now, evidenceRef: 'isolated-test-evidence', updatedAt: now });
    await db.insert(runtimeTargets).values({ id: targetId, userId: owner, targetType: 'ANDROID_DEVICE', backingRef: deviceId, authorityEpoch: 1, authorityHash: hash('source-authority'), onlineState: 'ONLINE', health: 'HEALTHY', lastSeenAt: now, manifestVersion: 'runtime-header-v1', manifestHash: hash('manifest'), metadata: {}, createdAt: now, updatedAt: now });
    binding = await db.transaction(tx => lockNotificationSource(tx, owner, { deviceAppConnectionId: appId, trustedDeviceId: deviceId, sourcePackage }));
    const receiptId = randomUUID();
    nativeItem = { eventId: hash(receiptId), contentHash: hash('signed-notification-fixture'), sourcePackage, postedAt: now.getTime(), capturedAt: now.getTime(), hasTitle: true, hasText: true, candidateKind: 'shipment_candidate', candidateResource: 'shipment', candidateConfidence: 75, candidateStatus: 'EXCEPTION', amountMinor: null, currency: null, parserVersion: 'generic-notification-v1', status: 'received_unclassified' };
    await db.insert(mobileNotificationReceipts).values({ id: receiptId, userId: owner, deviceAppConnectionId: appId, eventId: String(nativeItem.eventId), payloadHash: nativeNotificationReceiptPayloadHash(nativeItem)!, sourcePackage, postedAt: now, amountMinor: null, status: 'verified', snapshotJson: { schema: 'mobile-notification-minimal-v2', candidateKind: 'shipment_candidate', candidateResource: 'shipment', candidateConfidence: 75, candidateStatus: 'EXCEPTION', parserVersion: 'generic-notification-v1', sourceBinding: binding, eventEvidenceHash: nativeNotificationReceiptEventEvidenceHash(nativeItem)! }, receivedAt: now, verifiedAt: now });
    receipt = (await db.select().from(mobileNotificationReceipts).where(eq(mobileNotificationReceipts.id, receiptId)))[0];
    const pipeline = new RealityPipelineService(db, { append: async () => undefined } as never, { enqueueTruthChange: async () => undefined } as never, {} as never);
    const observation = await pipeline.ingest(owner, { sourceMode: 'NOTIFICATION', providerKey: sourcePackage, connectionId: null, externalEventKey: receiptId, parserKey: 'generic.shipment-status.v1', resourceHint: 'shipment', payload: { subjectKey: receiptId, status: 'EXCEPTION' }, evidenceHash: hash({ receiptId, payloadHash: receipt.payloadHash, candidateResource: 'shipment', parserVersion: 'generic-notification-v1' }), observedAt: now.toISOString(), occurredAt: now.toISOString() });
    const truth = await pipeline.confirmCandidate(owner, observation.candidates[0].id, { sourceReceiptId: receiptId, verifiedBy: 'user_confirmation', verificationMethod: 'user_confirmation_after_device_key_proof' });
    truthId = truth.id; truthVersionId = truth.currentVersionId!; observationId = observation.observationId;
    provenanceId = (await db.select().from(truthProvenance).where(eq(truthProvenance.truthRecordVersionId, truthVersionId)))[0].id;
    const compiled = compileNotificationWatchAuthoring('daily_life.delivery', { recipeKey: 'notification.shipment-watch.v1', sourcePackage, connectionId: appId, trustedDeviceId: deviceId, lookbackHours: 168, notificationPolicy: 'EXCEPTION_ONLY' }, 'JD provenance fixture');
    await db.insert(plans).values({ id: planId, userId: owner, executionScope: 'PLAN', status: 'active', createdAt: now, updatedAt: now });
    await db.insert(planVersions).values({ id: versionId, planId, versionNumber: 1, name: 'JD provenance fixture', domain: 'daily_life', automationLevel: 'L1', definitionHash: catalogHash(compiled.definition), createdBy: owner, createdAt: now });
    await db.update(plans).set({ activeVersionId: versionId, currentVersionId: versionId }).where(eq(plans.id, planId));
    const facts = [{ demandId: 'shipment-status', factKey: 'shipment.status' }], selected = [{ demandId: 'shipment-status', factKey: 'shipment.status', selectedSourceId: 'device-app:' + appId, selectedSource: { kind: 'TRUSTED_DEVICE', trustedDeviceId: deviceId, deviceAppConnectionId: appId } }];
    const offerId = randomUUID();
    await db.insert(planOfferSnapshots).values({ id: offerId, userId: owner, offerKey: offerId, scenarioKey: 'daily_life.delivery', scenarioRevision: 2, contractHash: hash('contract'), offerHash: hash('offer'), preconditionHash: hash('precondition'), goalJson: compiled.goal, subjectJson: compiled.subject, factDemandsJson: facts, sourceResolutionJson: selected, offerJson: {}, status: 'chosen', expiresAt: new Date(now.getTime() + 3_600_000), chosenAt: now, createdAt: now });
    await db.insert(planCreationContracts).values({ id: contractId, userId: owner, planId, planVersionId: versionId, offerSnapshotId: offerId, idempotencyKey: offerId, scenarioKey: 'daily_life.delivery', scenarioRevision: 2, contractHash: hash('contract'), confirmationHash: hash('confirmation'), goalJson: compiled.goal, subjectJson: compiled.subject, factDemandsJson: facts, sourceSelectionJson: selected, offerJson: {}, createdAt: now });
    await db.insert(strategyRuntimeBindings).values({ id: runtimeId, userId: owner, planVersionId: versionId, scenarioKey: 'daily_life.delivery', scenarioRevision: 2, strategyKey: 'SILENT_FOLLOW_UP', strategyRevision: 1, schemaVersion: '1', runtimeHash: compiled.runtime.runtimeHash, runtimeJson: compiled.runtime as never, createdAt: now });
    await db.insert(truthFactDependencies).values({ id: randomUUID(), bindingId: runtimeId, userId: owner, planVersionId: versionId, dependencyKey: hash('dependency-' + runtimeId), factKey: 'shipment.status', resourceType: 'shipment', field: 'status', scope: 'RESOURCE_WIDE', createdAt: now });
    await db.insert(strategyRuntimeWakeups).values({ id: wakeupId, bindingId: runtimeId, userId: owner, planVersionId: versionId, truthRecordVersionId: truthVersionId, wakeupKey: hash(wakeupId), factKey: 'shipment.status', resourceType: 'shipment', subjectKey: receiptId, triggerMode: 'FACT_CHANGED', status: 'EVALUATED', createdAt: now });
    await db.insert(strategyRuntimeDecisions).values({ id: randomUUID(), bindingId: runtimeId, wakeupId, userId: owner, inputHash: hash('input'), decisionHash: hash('decision'), triggerDecisionJson: {}, conditionDecisionJson: { result: true }, lifecycleTraceJson: [], result: 'READY_FOR_PLAN_ENGINE', evaluatedAt: now });
    guard = new TruthHandoffGuard(db);
    proof = (await db.transaction(tx => guard.lockTruth(owner, planId, wakeupId, tx))).proof;
  });
  afterAll(async () => { await bundle?.pool.end(); });
  beforeEach(async () => {
    const db = bundle.db;
    await db.delete(deviceTasks).where(eq(deviceTasks.userId, owner));
    await db.update(trustedDevices).set({ status: 'active', revokedAt: null }).where(eq(trustedDevices.id, deviceId));
    await db.update(deviceAppConnections).set({ enabled: 1, modesJson: ['notification_read'], updatedAt: now }).where(eq(deviceAppConnections.id, appId));
    await db.update(localCapabilityStates).set({ userGrant: true, systemPermission: 'GRANTED', health: 'HEALTHY', checkedAt: new Date() }).where(and(eq(localCapabilityStates.userId, owner), eq(localCapabilityStates.trustedDeviceId, deviceId), eq(localCapabilityStates.capability, 'notification.read')));
    await db.update(runtimeTargets).set({ authorityEpoch: 1, health: 'HEALTHY' }).where(eq(runtimeTargets.id, targetId));
    await db.update(mobileNotificationReceipts).set({ status: 'verified', snapshotJson: receipt.snapshotJson, postedAt: now }).where(eq(mobileNotificationReceipts.id, receipt.id));
    await db.update(sourceObservations).set({ externalEventKey: receipt.id }).where(eq(sourceObservations.id, observationId));
  });

  it('accepts the owned confirmed receipt through real Observation/Candidate/Truth provenance without an AppReadSession', async () => {
    const sessions = await bundle.db.select().from(appReadSessions).where(eq(appReadSessions.userId, owner));
    expect(sessions).toEqual([]);
    expect(proof.notificationSourceProof).toMatchObject({ ...binding, receiptId: receipt.id, observationId, payloadHash: receipt.payloadHash });
    expect(await guard.revalidateTruth(owner, proof)).toMatchObject({ subjectKey: receipt.id, value: { status: 'EXCEPTION' } });
  });
  it('cannot reuse another owner receipt or handoff proof', async () => {
    await expect(bundle.db.transaction(tx => lockNotificationReceiptSource(tx, stranger, receipt))).rejects.toThrow('no longer authorized');
    await expect(guard.revalidateTruth(stranger, proof)).rejects.toThrow('ownership changed');
  });
  it('requires immutable receipt source binding, preserving legacy receipts without retroactive upgrades', async () => {
    const { sourceBinding: _binding, ...legacy } = receipt.snapshotJson;
    await bundle.db.update(mobileNotificationReceipts).set({ snapshotJson: legacy }).where(eq(mobileNotificationReceipts.id, receipt.id));
    await expect(guard.revalidateTruth(owner, proof)).rejects.toThrow('NOTIFICATION_SOURCE_AUTHORITY');
    expect((await bundle.db.select().from(mobileNotificationReceipts).where(eq(mobileNotificationReceipts.id, receipt.id)))[0].snapshotJson).not.toHaveProperty('sourceBinding');
  });
  it('rejects an observation that is not bound to this exact receipt and frozen watch scope', async () => {
    await bundle.db.update(sourceObservations).set({ externalEventKey: randomUUID() }).where(eq(sourceObservations.id, observationId));
    await expect(guard.revalidateTruth(owner, proof)).rejects.toThrow('NOTIFICATION_RECEIPT_PROVENANCE');
    await bundle.db.update(sourceObservations).set({ externalEventKey: receipt.id }).where(eq(sourceObservations.id, observationId));
    await bundle.db.update(mobileNotificationReceipts).set({ postedAt: new Date(now.getTime() - 169 * 3_600_000) }).where(eq(mobileNotificationReceipts.id, receipt.id));
    await expect(guard.revalidateTruth(owner, proof)).rejects.toThrow('NOTIFICATION_RECEIPT_PROVENANCE');
  });
  it('revalidates permission immediately before execution and retains historical Truth/provenance', async () => {
    const before = (await bundle.db.select().from(truthRecordVersions).where(eq(truthRecordVersions.id, truthVersionId)))[0];
    await bundle.db.update(localCapabilityStates).set({ systemPermission: 'DENIED' }).where(and(eq(localCapabilityStates.userId, owner), eq(localCapabilityStates.trustedDeviceId, deviceId)));
    await expect(guard.revalidateTruth(owner, proof)).rejects.toThrow('NOTIFICATION_SOURCE_AUTHORITY');
    expect((await bundle.db.select().from(truthRecordVersions).where(eq(truthRecordVersions.id, truthVersionId)))[0]).toEqual(before);
    expect((await bundle.db.select().from(truthRecords).where(eq(truthRecords.id, truthId)))[0].currentVersionId).toBe(truthVersionId);
    expect((await bundle.db.select().from(truthProvenance).where(eq(truthProvenance.id, provenanceId)))[0].observationId).toBe(observationId);
  });
  it('fences a stale captured authority epoch even when the source is available again', async () => {
    await bundle.db.update(runtimeTargets).set({ authorityEpoch: 2 }).where(eq(runtimeTargets.id, targetId));
    await expect(guard.revalidateTruth(owner, proof)).rejects.toThrow('NOTIFICATION_SOURCE_AUTHORITY');
  });
  it('fences a changed source version instead of silently rebinding old Truth', async () => {
    await bundle.db.update(deviceAppConnections).set({ updatedAt: new Date(now.getTime() + 1000) }).where(eq(deviceAppConnections.id, appId));
    await expect(guard.revalidateTruth(owner, proof)).rejects.toThrow('NOTIFICATION_SOURCE_AUTHORITY');
  });
  async function freshRead(current: NotificationSourceBinding, item: Record<string, unknown> = nativeItem) {
    const id = randomUUID(), scopeStart = now.getTime() - 1000, scopeEnd = now.getTime() + 1000, contentJson = JSON.stringify([item]);
    const result = { capability: 'notification.read', state: 'VERIFIED_PRESENT', observedAt: Date.now(), scopeStart, scopeEnd, itemCount: 1, items: [item], contentJson, contentHash: createHash('sha256').update(contentJson).digest('hex') };
    await bundle.db.insert(deviceTasks).values({ id, userId: owner, trustedDeviceId: deviceId, deviceId: 'notification-provenance-' + deviceId, taskType: 'NATIVE_NOTIFICATION_READ', factKey: 'shipment.status', resourceType: 'shipment', payloadJson: { sourcePackage, sourceId: 'device-app:' + appId, notificationSourceBinding: current, scopeStart, scopeEnd, planNotificationRead: { schema: 'plan-notification-read.v1', planId, planVersionId: versionId } }, status: 'SUCCEEDED', resultJson: result, resultHash: realityValueHash(result), createdAt: new Date(), updatedAt: new Date(), completedAt: new Date() });
    return id;
  }
  it('accepts an exact authorized re-observation after an epoch change without upgrading original receipt/Truth', async () => {
    const original = (await bundle.db.select().from(mobileNotificationReceipts).where(eq(mobileNotificationReceipts.id, receipt.id)))[0];
    const oldTruth = (await bundle.db.select().from(truthRecordVersions).where(eq(truthRecordVersions.id, truthVersionId)))[0];
    await bundle.db.update(runtimeTargets).set({ authorityEpoch: 2 }).where(eq(runtimeTargets.id, targetId));
    const current = { ...binding, authorityEpoch: 2 }, recapturedItem = { ...nativeItem, capturedAt: Number(nativeItem.capturedAt) + 100 };
    expect(nativeNotificationReceiptPayloadHash(recapturedItem)).not.toBe(receipt.payloadHash);
    const freshId = await freshRead(current, recapturedItem);
    const newProof = (await bundle.db.transaction(tx => guard.lockTruth(owner, planId, wakeupId, tx))).proof;
    expect(newProof.notificationSourceProof).toMatchObject({ ...current, reobservation: { taskId: freshId } });
    await freshRead(current); // A later read cannot change the proof frozen for execution.
    expect(await guard.revalidateTruth(owner, newProof)).toMatchObject({ value: { status: 'EXCEPTION' } });
    expect((await bundle.db.select().from(mobileNotificationReceipts).where(eq(mobileNotificationReceipts.id, receipt.id)))[0]).toEqual(original);
    expect((await bundle.db.select().from(truthRecordVersions).where(eq(truthRecordVersions.id, truthVersionId)))[0]).toEqual(oldTruth);
  });
  it('rejects re-observation with changed source content or a stale read authority', async () => {
    await bundle.db.update(runtimeTargets).set({ authorityEpoch: 2 }).where(eq(runtimeTargets.id, targetId));
    await freshRead({ ...binding, authorityEpoch: 2 }, { ...nativeItem, contentHash: hash('different-real-notice') });
    await freshRead(binding);
    await expect(bundle.db.transaction(tx => guard.lockTruth(owner, planId, wakeupId, tx))).rejects.toThrow('NOTIFICATION_SOURCE_AUTHORITY');
  });
  it('fences a re-observation proof when authority changes again before execution', async () => {
    await bundle.db.update(runtimeTargets).set({ authorityEpoch: 2 }).where(eq(runtimeTargets.id, targetId));
    await freshRead({ ...binding, authorityEpoch: 2 });
    const newProof = (await bundle.db.transaction(tx => guard.lockTruth(owner, planId, wakeupId, tx))).proof;
    await bundle.db.update(runtimeTargets).set({ authorityEpoch: 3 }).where(eq(runtimeTargets.id, targetId));
    await expect(guard.revalidateTruth(owner, newProof)).rejects.toThrow('NOTIFICATION_SOURCE_AUTHORITY');
  });
  it('rejects source opt-out and revoked device despite a previously valid handoff', async () => {
    await bundle.db.update(deviceAppConnections).set({ modesJson: [] }).where(eq(deviceAppConnections.id, appId));
    await expect(guard.revalidateTruth(owner, proof)).rejects.toThrow('NOTIFICATION_SOURCE_AUTHORITY');
    await bundle.db.update(deviceAppConnections).set({ modesJson: ['notification_read'] }).where(eq(deviceAppConnections.id, appId));
    await bundle.db.update(trustedDevices).set({ status: 'revoked', revokedAt: new Date() }).where(eq(trustedDevices.id, deviceId));
    await expect(guard.revalidateTruth(owner, proof)).rejects.toThrow('NOTIFICATION_SOURCE_AUTHORITY');
  });
  it('rejects source revocation after hydration but before notification commit without changing the execution proof', async () => {
    const hydrated = await guard.revalidateTruth(owner, proof), executionId = randomUUID();
    await bundle.db.insert(executions).values({ id: executionId, userId: owner, planId, planVersionId: versionId, definitionHash: proof.definitionHash, requestId: 'notify-race:' + executionId, triggerType: 'manual', triggerPayloadJson: { wakeupRef: wakeupId }, status: 'running', declaredRiskLevel: 'R0', approvalStatus: 'not_required', executionPolicyVersion: 'fixture-v1', resolvedRetryPolicyJson: {}, resolvedFallbackPolicyJson: {}, resolvedRiskSnapshotJson: { truthHandoffProof: proof }, createdAt: now, updatedAt: now });
    const original = (await bundle.db.select().from(executions).where(eq(executions.id, executionId)))[0];
    const emit = vi.fn(async () => undefined), pass = { enrichContext: (value: unknown) => value } as never;
    const executor = new ActionExecutor({} as never, {} as never, { emit } as never, pass, pass, pass, pass, pass, pass, pass, bundle.db, {} as never, guard);
    await bundle.db.update(deviceAppConnections).set({ modesJson: [] }).where(eq(deviceAppConnections.id, appId));
    await expect(executor.execute(owner, executionId, { actionType: 'notify', config: { channel: 'in_app', eventType: 'logistics_exception', priority: 'P1' }, riskLevel: 'R0', stepOrder: 1 } as never, { hydratedFactValue: hydrated.value, shouldNotify: true, humanSummary: '已核实物流异常' })).rejects.toThrow('NOTIFICATION_SOURCE_AUTHORITY');
    expect(emit).not.toHaveBeenCalled();
    expect(await bundle.db.select().from(notifications).where(eq(notifications.executionId, executionId))).toEqual([]);
    expect((await bundle.db.select().from(executions).where(eq(executions.id, executionId)))[0]).toEqual(original);
  });
  it('retains the existing owned AppReadSession provenance path for prior contracts', async () => {
    const id = randomUUID();
    await bundle.db.update(planCreationContracts).set({ goalJson: { constraints: { recipeKey: 'prior-app-read-contract' } } }).where(eq(planCreationContracts.id, contractId));
    await bundle.db.insert(appReadSessions).values({ id, userId: owner, trustedDeviceId: deviceId, deviceAppConnectionId: appId, targetPackage: sourcePackage, modesJson: ['notification_read'], status: 'COMPLETED', correlationId: hash(id), expiresAt: new Date(now.getTime() + 60_000), endedAt: now, createdAt: now, updatedAt: now });
    await bundle.db.insert(appReadSessionEvents).values({ id: randomUUID(), sessionId: id, userId: owner, eventKey: hash('event-' + id), eventType: 'NOTIFICATION_CAPTURED', sourceMode: 'NOTIFICATION', packageName: sourcePackage, payloadHash: hash('legacy-session-event'), payloadJson: {}, observationId, createdAt: now });
    const priorProof = (await bundle.db.transaction(tx => guard.lockTruth(owner, planId, wakeupId, tx))).proof;
    expect(priorProof).not.toHaveProperty('notificationSourceProof');
    expect(await guard.revalidateTruth(owner, priorProof)).toMatchObject({ value: { status: 'EXCEPTION' } });
  });
});
