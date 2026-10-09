import { ForbiddenException } from '@nestjs/common';
import { deviceAppConnections, deviceTasks, localCapabilityStates, mobileNotificationReceipts, runtimeTargets, trustedDevices } from '@lazy-armor/database';
import { catalogHash, localCapabilityAvailability, realityValueHash } from '@lazy-armor/plan-schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RealityExecutor } from '../reality-pipeline/reality-pipeline.service';

/** The source identity that was authorized when the signed receipt arrived. */
export const notificationSourceBindingSchema = z.object({
  schema: z.literal('notification-source-binding.v1'),
  deviceAppConnectionId: z.string().uuid(),
  trustedDeviceId: z.string().uuid(),
  targetId: z.string().uuid(),
  authorityEpoch: z.number().int().positive(),
  sourceVersion: z.string().datetime(),
  sourcePackage: z.string().min(1).max(255),
}).strict();
export type NotificationSourceBinding = z.infer<typeof notificationSourceBindingSchema>;
export type NotificationReceiptSource = Pick<typeof mobileNotificationReceipts.$inferSelect, 'id' | 'userId' | 'deviceAppConnectionId' | 'eventId' | 'payloadHash' | 'postedAt' | 'sourcePackage' | 'snapshotJson'>;
export type NotificationSourceIdentity = Pick<NotificationSourceBinding, 'deviceAppConnectionId' | 'trustedDeviceId' | 'sourcePackage'>;
export type NotificationReobservationProof = { taskId: string; resultHash: string };
export type NotificationReceiptSourceProof = NotificationSourceBinding & { reobservation?: NotificationReobservationProof };

function reject(code: string): never {
  throw new ForbiddenException({ code, message: 'The notification source is no longer authorized for this evidence' });
}

/** No legacy receipt is upgraded by inventing a binding after its capture. */
export function notificationSourceBindingOf(receipt: NotificationReceiptSource): NotificationSourceBinding {
  const parsed = notificationSourceBindingSchema.safeParse(receipt.snapshotJson.sourceBinding);
  if (!parsed.success) return reject('NOTIFICATION_RECEIPT_SOURCE_BINDING_REQUIRED');
  return parsed.data;
}

export function assertFrozenNotificationSourceBinding(current: NotificationSourceBinding, expected: NotificationSourceBinding): void {
  if (catalogHash(current) !== catalogHash(expected)) reject('NOTIFICATION_SOURCE_AUTHORITY_CHANGED');
}

/**
 * Use inside the caller's transaction, including the eventual Truth/Result
 * commit. The same device → app → grant → target lock order is used by both
 * candidate confirmation and Plan handoff; a preflight read alone is not proof.
 */
export async function lockNotificationReceiptSource(store: RealityExecutor, userId: string, receipt: NotificationReceiptSource, expectedReobservation?: NotificationReobservationProof): Promise<NotificationReceiptSourceProof> {
  const frozen = notificationSourceBindingOf(receipt);
  if (receipt.userId !== userId || receipt.deviceAppConnectionId !== frozen.deviceAppConnectionId || receipt.sourcePackage !== frozen.sourcePackage) {
    return reject('NOTIFICATION_SOURCE_IDENTITY_MISMATCH');
  }
  const current = await lockNotificationSource(store, userId, frozen);
  if (catalogHash(current) === catalogHash(frozen)) return current;
  // A later authorized read may re-observe the SAME notification after an
  // epoch/source change. Its immutable Task evidence authorizes consumption;
  // it never upgrades the old receipt or its original Truth/provenance.
  const tasks = await store.select().from(deviceTasks).where(and(
    eq(deviceTasks.userId, userId), eq(deviceTasks.trustedDeviceId, current.trustedDeviceId), eq(deviceTasks.taskType, 'NATIVE_NOTIFICATION_READ'), eq(deviceTasks.status, 'SUCCEEDED'),
    sql`JSON_UNQUOTE(JSON_EXTRACT(${deviceTasks.payloadJson}, '$.notificationSourceBinding.deviceAppConnectionId')) = ${current.deviceAppConnectionId}`,
    ...(expectedReobservation ? [eq(deviceTasks.id, expectedReobservation.taskId)] : []),
  )).orderBy(desc(deviceTasks.completedAt)).limit(100).for('update');
  for (const task of tasks) {
    const source = notificationSourceBindingSchema.safeParse(task.payloadJson.notificationSourceBinding), result = task.resultJson;
    if (!source.success || catalogHash(source.data) !== catalogHash(current) || !result || !task.resultHash || task.resultHash !== realityValueHash(result)
      || (expectedReobservation && task.resultHash !== expectedReobservation.resultHash) || !task.completedAt || task.completedAt.getTime() > Date.now() + 5000 || Date.now() - task.completedAt.getTime() > 24 * 60 * 60 * 1000
      || task.payloadJson.sourcePackage !== receipt.sourcePackage || result.capability !== 'notification.read' || result.state !== 'VERIFIED_PRESENT'
      || result.scopeStart !== task.payloadJson.scopeStart || result.scopeEnd !== task.payloadJson.scopeEnd || typeof result.scopeStart !== 'number' || typeof result.scopeEnd !== 'number'
      || receipt.postedAt.getTime() < result.scopeStart || receipt.postedAt.getTime() >= result.scopeEnd || !Array.isArray(result.items) || result.itemCount !== result.items.length
      || typeof result.contentJson !== 'string' || createHash('sha256').update(result.contentJson).digest('hex') !== result.contentHash) continue;
    let encodedItems: unknown;
    try { encodedItems = JSON.parse(result.contentJson); } catch { continue; }
    if (realityValueHash(encodedItems) !== realityValueHash(result.items)) continue;
    const item = result.items.find((value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
      && (value as Record<string, unknown>).eventId === receipt.eventId && (value as Record<string, unknown>).sourcePackage === receipt.sourcePackage) as Record<string, unknown> | undefined;
    const eventEvidenceHash = receipt.snapshotJson.eventEvidenceHash;
    const matchesEvidence = typeof eventEvidenceHash === 'string' && /^[a-f0-9]{64}$/.test(eventEvidenceHash)
      ? nativeNotificationReceiptEventEvidenceHash(item ?? {}) === eventEvidenceHash
      : nativeNotificationReceiptPayloadHash(item ?? {}) === receipt.payloadHash;
    if (!item || item.postedAt !== receipt.postedAt.getTime() || item.candidateStatus !== receipt.snapshotJson.candidateStatus || !matchesEvidence) continue;
    return { ...current, reobservation: { taskId: task.id, resultHash: task.resultHash } };
  }
  return reject('NOTIFICATION_SOURCE_AUTHORITY_CHANGED');
}

/** Hash the minimized native item exactly as the receipt ingress contract does. */
export function nativeNotificationReceiptPayloadHash(item: Record<string, unknown>): string | null {
  if (typeof item.postedAt !== 'number' || !Number.isFinite(item.postedAt) || typeof item.capturedAt !== 'number' || !Number.isFinite(item.capturedAt)) return null;
  try {
    return createHash('sha256').update(JSON.stringify({
      eventId: item.eventId, contentHash: item.contentHash, sourcePackage: item.sourcePackage,
      postedAt: new Date(item.postedAt).toISOString(), capturedAt: new Date(item.capturedAt).toISOString(),
      hasTitle: item.hasTitle, hasText: item.hasText, candidateKind: item.candidateKind, candidateResource: item.candidateResource,
      candidateConfidence: item.candidateConfidence, amountMinor: item.amountMinor, currency: item.currency, parserVersion: item.parserVersion,
    })).digest('hex');
  } catch { return null; }
}

/** Re-capture time is not part of the identity of the notification's content. */
export function nativeNotificationReceiptEventEvidenceHash(item: Record<string, unknown>): string | null {
  if (typeof item.postedAt !== 'number' || !Number.isFinite(item.postedAt)) return null;
  try {
    return createHash('sha256').update(JSON.stringify({
      eventId: item.eventId, contentHash: item.contentHash, sourcePackage: item.sourcePackage,
      postedAt: new Date(item.postedAt).toISOString(),
      hasTitle: item.hasTitle, hasText: item.hasText, candidateKind: item.candidateKind, candidateResource: item.candidateResource,
      candidateConfidence: item.candidateConfidence, amountMinor: item.amountMinor, currency: item.currency, parserVersion: item.parserVersion,
    })).digest('hex');
  } catch { return null; }
}

/** Initial source freeze is computed exclusively from owned backing authority. */
export async function lockNotificationSource(store: RealityExecutor, userId: string, identity: NotificationSourceIdentity): Promise<NotificationSourceBinding> {
  const device = (await store.select().from(trustedDevices).where(and(eq(trustedDevices.id, identity.trustedDeviceId), eq(trustedDevices.userId, userId))).limit(1).for('update'))[0];
  const app = (await store.select().from(deviceAppConnections).where(and(eq(deviceAppConnections.id, identity.deviceAppConnectionId), eq(deviceAppConnections.userId, userId), eq(deviceAppConnections.trustedDeviceId, identity.trustedDeviceId))).limit(1).for('update'))[0];
  const grant = (await store.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.userId, userId), eq(localCapabilityStates.trustedDeviceId, identity.trustedDeviceId), eq(localCapabilityStates.capability, 'notification.read'))).limit(1).for('update'))[0];
  const target = (await store.select().from(runtimeTargets).where(and(eq(runtimeTargets.userId, userId), eq(runtimeTargets.targetType, 'ANDROID_DEVICE'), eq(runtimeTargets.backingRef, identity.trustedDeviceId))).limit(1).for('update'))[0];
  if (!device || device.status !== 'active' || device.revokedAt || !app || app.deviceId !== device.deviceId || app.packageName !== identity.sourcePackage || app.enabled !== 1 || app.launchable !== 1 || !app.modesJson.includes('notification_read') || !grant
    || localCapabilityAvailability({ key: grant.capability, userGrant: grant.userGrant, systemPermission: grant.systemPermission as never, health: grant.health as never, checkedAt: grant.checkedAt.getTime() }, Date.now()) !== 'AVAILABLE'
    || !target || target.health === 'UNAVAILABLE') {
    return reject('NOTIFICATION_SOURCE_NOT_AUTHORIZED');
  }
  return {
    schema: 'notification-source-binding.v1', deviceAppConnectionId: app.id, trustedDeviceId: device.id,
    targetId: target.id, authorityEpoch: target.authorityEpoch, sourceVersion: app.updatedAt.toISOString(), sourcePackage: app.packageName,
  };
}
