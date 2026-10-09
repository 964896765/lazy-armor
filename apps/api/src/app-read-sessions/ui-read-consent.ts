import { ForbiddenException } from '@nestjs/common';
import { appReadSessionEvents, localCapabilityStates } from '@lazy-armor/database';
import { frozenGoalPageReadSchema, isSensitiveField, localCapabilityAvailability, UI_READ_CONSENT_VERSION, type UiReadConsent } from '@lazy-armor/plan-schema';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { RealityExecutor } from '../reality-pipeline/reality-pipeline.service';
import { resolveUiReadProfile } from '../structured-read/app-read-profiles';

export const uiConsentEventKey = (id: string) => createHash('sha256').update('ui-read-consent:' + id).digest('hex');

export function validateUiReadConsent(packageName: string, consent: UiReadConsent | undefined) {
  const profile = resolveUiReadProfile(packageName);
  if (!profile || !consent || consent.version !== UI_READ_CONSENT_VERSION || !Array.isArray(consent.requestedFields)
    || !consent.requestedFields.length || consent.requestedFields.length > 30 || new Set(consent.requestedFields).size !== consent.requestedFields.length
    || consent.requestedFields.some(field => typeof field !== 'string' || !profile.allowedSelectors.includes(field) || field.includes('*') || isSensitiveField(field) || profile.blockedFields.includes(field))) {
    throw new ForbiddenException('Explicit bounded UI read consent for a registered profile is required');
  }
  return { version: UI_READ_CONSENT_VERSION, requestedFields: [...consent.requestedFields] };
}

export async function assertUiReadCapability(store: RealityExecutor, userId: string, deviceId: string, lock = false) {
  const query = store.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.userId, userId), eq(localCapabilityStates.trustedDeviceId, deviceId), eq(localCapabilityStates.capability, 'accessibility.read'))).limit(1);
  const state = (await (lock ? query.for('update') : query))[0];
  if (!state || state.manifestVersion !== 'android-local-v5' || localCapabilityAvailability({ key: state.capability, userGrant: state.userGrant, systemPermission: state.systemPermission as never, health: state.health as never, checkedAt: state.checkedAt.getTime() }, Date.now()) !== 'AVAILABLE') {
    throw new ForbiddenException('UI read needs its own current user grant, system permission and healthy observer');
  }
  return state;
}

export async function frozenUiReadConsent(store: RealityExecutor, userId: string, sessionId: string) {
  const row = (await store.select().from(appReadSessionEvents).where(and(eq(appReadSessionEvents.sessionId, sessionId), eq(appReadSessionEvents.userId, userId), eq(appReadSessionEvents.eventKey, uiConsentEventKey(sessionId)))).limit(1))[0];
  const value = row?.sourceMode === 'UI_READ' ? row.payloadJson : undefined;
  if (!value || value.version !== UI_READ_CONSENT_VERSION || !Array.isArray(value.requestedFields)
    || !value.requestedFields.length || value.requestedFields.some(field => typeof field !== 'string')
    || typeof value.sourceVersion !== 'string' || typeof value.grantEvidenceRef !== 'string') return undefined;
  const goal = value.goal === undefined ? undefined : frozenGoalPageReadSchema.parse(value.goal);
  return { version: UI_READ_CONSENT_VERSION, requestedFields: value.requestedFields as string[], sourceVersion: value.sourceVersion, grantEvidenceRef: value.grantEvidenceRef, ...(goal ? { goal } : {}) };
}
