import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  APP_READ_SESSION_HEARTBEAT_GRACE_SECONDS, APP_READ_SESSION_TERMINAL_STATUSES, appReadSessionStatusForEvent,
  canTransitionAppReadSession, isExactAndroidPackage, realityValueHash, type AppReadSessionEventType, type AppReadSessionStatus,
} from '@lazy-armor/plan-schema';
import { appReadSessionEvents, appReadSessions, deviceAppConnections } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { RealityPipelineService } from '../reality-pipeline/reality-pipeline.service';
import { TrustedDevicesService } from '../trusted-devices/trusted-devices.service';
import type { AppReadHeartbeatDto, CreateAppReadSessionDto, CreateAppReadSessionEventDto } from './dto';

const ACTIVE = new Set<AppReadSessionStatus>(['CREATED', 'WAITING_FOREGROUND', 'READING']);
const CAPTURE_EVENTS = new Set<AppReadSessionEventType>(['NOTIFICATION_CAPTURED', 'SHARE_CAPTURED']);

export interface AppReadSessionResponse {
  id: string;
  connectionId: string;
  trustedDeviceId: string;
  targetPackage: string;
  modes: string[];
  status: string;
  correlationId: string;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  expiresAt: string;
  endedAt: string | null;
  terminalReason: string | null;
  events: Array<{
    id: string; eventKey: string; eventType: string; sourceMode: string | null; packageName: string | null;
    observationId: string | null; candidateFactId: string | null; createdAt: string;
  }>;
}

@Injectable()
export class AppReadSessionsService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly audit: AuditService,
    private readonly pipeline: RealityPipelineService,
    private readonly trustedDevices: TrustedDevicesService,
  ) {}

  async create(userId: string, input: CreateAppReadSessionDto, signedDeviceId: string) {
    if (!isExactAndroidPackage(input.targetPackage)) throw new BadRequestException('A concrete Android target package is required');
    const connection = (await this.db.select().from(deviceAppConnections).where(and(
      eq(deviceAppConnections.id, input.connectionId), eq(deviceAppConnections.userId, userId),
    )).limit(1))[0];
    if (!connection || !connection.enabled) throw new NotFoundException('Enabled device app connection not found');
    if (connection.trustedDeviceId !== signedDeviceId) throw new ForbiddenException('Session must be signed by the device bound to this app connection');
    if (connection.packageName !== input.targetPackage) throw new ForbiddenException('Session package must exactly match the connected app');
    await this.trustedDevices.assertActive(userId, signedDeviceId, connection.deviceId);
    const modes = [...new Set(input.modes)];
    if (modes.includes('NOTIFICATION') && !connection.modesJson.includes('notification_read')) {
      throw new ForbiddenException('Notification acquisition is not enabled for this app connection');
    }
    await this.expireActiveForDevice(signedDeviceId);
    if ((await this.db.select({ id: appReadSessions.id }).from(appReadSessions).where(eq(appReadSessions.activeDeviceKey, signedDeviceId)).limit(1))[0]) {
      throw new ConflictException('This trusted device already has an active read session');
    }
    const id = newId(); const now = new Date(); const expiresAt = new Date(now.getTime() + input.durationSeconds * 1000);
    try {
      await this.db.insert(appReadSessions).values({
        id, userId, trustedDeviceId: signedDeviceId, deviceAppConnectionId: connection.id, targetPackage: connection.packageName,
        modesJson: modes, status: 'WAITING_FOREGROUND', activeDeviceKey: signedDeviceId, correlationId: sha256(id),
        startedAt: now, lastHeartbeatAt: null, expiresAt, endedAt: null, terminalReason: null, createdAt: now, updatedAt: now,
      });
    } catch (error) {
      if (isDuplicate(error)) throw new ConflictException('This trusted device already has an active read session');
      throw error;
    }
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'APP_READ_SESSION_CREATED', resourceType: 'app_read_session', resourceId: id,
      userId, correlationId: sha256(id), changeSummary: 'Created a bounded foreground-only app read session', source: 'api', result: 'success',
    });
    return this.get(userId, id);
  }

  async current(userId: string) {
    await this.expireForUser(userId);
    const row = (await this.db.select({ id: appReadSessions.id }).from(appReadSessions)
      .where(and(eq(appReadSessions.userId, userId), isNotNull(appReadSessions.activeDeviceKey)))
      .orderBy(desc(appReadSessions.createdAt)).limit(1))[0];
    return row ? this.get(userId, row.id) : null;
  }

  async get(userId: string, id: string): Promise<AppReadSessionResponse> {
    const row = await this.getRow(userId, id);
    if (ACTIVE.has(row.status as AppReadSessionStatus) && row.expiresAt.getTime() <= Date.now()) {
      await this.terminate(row, 'TIMEOUT', 'SESSION_EXPIRED');
      return this.get(userId, id);
    }
    const events = await this.db.select().from(appReadSessionEvents)
      .where(eq(appReadSessionEvents.sessionId, id)).orderBy(appReadSessionEvents.createdAt);
    return this.response(row, events);
  }

  async heartbeat(userId: string, id: string, input: AppReadHeartbeatDto, signedDeviceId: string) {
    const session = await this.assertActiveSession(userId, id, signedDeviceId);
    const observedAt = validObservedAt(input.observedAt);
    if (!input.usageAccessGranted) {
      await this.storeEvent(session, input.eventKey, 'NATIVE_ERROR', { reason: 'USAGE_ACCESS_REQUIRED' }, null, null);
      await this.terminate(session, 'FAILED', 'USAGE_ACCESS_REQUIRED');
      return this.get(userId, id);
    }
    const packageMatches = input.foregroundPackage === session.targetPackage;
    if ((input.nativeStatus === 'READING' || session.status === 'READING') && !packageMatches) {
      await this.storeEvent(session, input.eventKey, 'FOREGROUND_LOST', {
        expectedPackage: session.targetPackage, observedPackage: input.foregroundPackage,
      }, null, null);
      await this.terminate(session, 'APP_LEFT_FOREGROUND', 'FOREGROUND_PACKAGE_MISMATCH');
      return this.get(userId, id);
    }
    const nextStatus: AppReadSessionStatus = packageMatches ? 'READING' : 'WAITING_FOREGROUND';
    if (!canTransitionAppReadSession(session.status as AppReadSessionStatus, nextStatus)) {
      throw new ConflictException('Invalid session heartbeat transition');
    }
    const eventType: AppReadSessionEventType = packageMatches && session.status !== 'READING' ? 'FOREGROUND_CONFIRMED' : 'HEARTBEAT';
    const stored = await this.storeEvent(session, input.eventKey, eventType, {
      foregroundPackage: input.foregroundPackage, usageAccessGranted: true, nativeStatus: input.nativeStatus,
    }, null, null);
    if (!stored.duplicate) {
      await this.db.update(appReadSessions).set({ status: nextStatus, lastHeartbeatAt: observedAt, updatedAt: new Date() })
        .where(and(eq(appReadSessions.id, id), eq(appReadSessions.userId, userId)));
    }
    return this.get(userId, id);
  }

  async recordEvent(userId: string, id: string, input: CreateAppReadSessionEventDto, signedDeviceId: string) {
    const session = await this.assertActiveSession(userId, id, signedDeviceId);
    const observedAt = validObservedAt(input.observedAt);
    if (input.packageName && input.packageName !== session.targetPackage) {
      await this.terminate(session, 'APP_LEFT_FOREGROUND', 'EVENT_PACKAGE_MISMATCH');
      throw new ForbiddenException('Session event package does not match the foreground target');
    }
    if (CAPTURE_EVENTS.has(input.eventType)) return this.recordCapture(session, input);
    const next = appReadSessionStatusForEvent(session.status as AppReadSessionStatus, input.eventType);
    const stored = await this.storeEvent(session, input.eventKey, input.eventType, input.payload, input.evidenceHash ?? null, null);
    if (!stored.duplicate && next !== session.status) {
      if (APP_READ_SESSION_TERMINAL_STATUSES.has(next)) await this.terminate(session, next, input.eventType);
      else await this.db.update(appReadSessions).set({
        status: next,
        ...(input.eventType === 'FOREGROUND_CONFIRMED' ? { lastHeartbeatAt: observedAt } : {}),
        updatedAt: new Date(),
      }).where(eq(appReadSessions.id, session.id));
    }
    return { ...(await this.get(userId, id)), duplicate: stored.duplicate };
  }

  async stop(userId: string, id: string, signedDeviceId: string) {
    const session = await this.assertActiveSession(userId, id, signedDeviceId);
    await this.terminate(session, 'CANCELLED', 'USER_STOPPED');
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'APP_READ_SESSION_CANCELLED', resourceType: 'app_read_session', resourceId: id,
      userId, correlationId: session.correlationId, changeSummary: 'User cancelled the foreground read session', source: 'api', result: 'success',
    });
    return this.get(userId, id);
  }

  private async recordCapture(session: typeof appReadSessions.$inferSelect, input: CreateAppReadSessionEventDto) {
    if (session.status !== 'READING') throw new ConflictException('Capture is allowed only while the target app is confirmed in foreground');
    const requiredMode = input.eventType === 'NOTIFICATION_CAPTURED' ? 'NOTIFICATION' : 'SHARE';
    if (!session.modesJson.includes(requiredMode)) throw new ForbiddenException('This acquisition mode was not granted for the session');
    if (!session.lastHeartbeatAt || Date.now() - session.lastHeartbeatAt.getTime() > APP_READ_SESSION_HEARTBEAT_GRACE_SECONDS * 1000) {
      await this.terminate(session, 'FAILED', 'HEARTBEAT_STALE');
      throw new ForbiddenException('Session heartbeat is stale; capture failed closed');
    }
    if (input.packageName !== session.targetPackage) throw new ForbiddenException('Capture package must exactly match the session target');
    if (!input.evidenceHash) throw new BadRequestException('Capture evidenceHash is required');
    const payloadHash = eventPayloadHash(input.eventType, input.payload, input.evidenceHash);
    const old = await this.findEvent(session.id, input.eventKey);
    if (old) {
      if (old.payloadHash !== payloadHash) throw new ConflictException('Session event key cannot be reused with different evidence');
      return { ...(await this.get(session.userId, session.id)), duplicate: true, observationId: old.observationId, candidateFactId: old.candidateFactId };
    }
    let observationId: string | null = null;
    let candidateFactId: string | null = null;
    if (input.candidateKind === 'billing_transaction_candidate' && Number.isSafeInteger(input.amountMinor) && input.currency === 'CNY') {
      const reality = await this.pipeline.ingest(session.userId, {
        sourceMode: input.eventType === 'NOTIFICATION_CAPTURED' ? 'NOTIFICATION' : 'SHARE',
        providerKey: 'android-foreground-acquisition',
        externalEventKey: session.id + ':' + input.eventKey,
        parserKey: 'mobile-notification-billing.v1',
        resourceHint: 'mobile.billing.transaction',
        payload: {
          subjectKey: session.targetPackage + ':' + input.eventKey,
          amountMinor: input.amountMinor!,
          currency: 'CNY',
        },
        evidenceHash: input.evidenceHash,
        observedAt: input.observedAt,
      });
      observationId = reality.observationId;
      candidateFactId = reality.candidates[0]?.id ?? null;
    }
    const stored = await this.storeEvent(
      session, input.eventKey, input.eventType, input.payload, input.evidenceHash,
      input.eventType === 'NOTIFICATION_CAPTURED' ? 'NOTIFICATION' : 'SHARE', observationId, candidateFactId,
    );
    await this.audit.append({
      actorType: 'system', action: 'APP_READ_SESSION_CAPTURE_RECORDED', resourceType: 'app_read_session_event', resourceId: stored.id,
      userId: session.userId, correlationId: session.correlationId,
      changeSummary: observationId
        ? 'Recorded a foreground-bound capture and routed it into the generic reality pipeline'
        : 'Recorded an unclassified foreground-bound capture without creating truth',
      source: 'api', result: 'success',
    });
    return { ...(await this.get(session.userId, session.id)), duplicate: stored.duplicate, observationId, candidateFactId };
  }
  private async storeEvent(
    session: typeof appReadSessions.$inferSelect,
    eventKey: string,
    eventType: AppReadSessionEventType,
    payload: Record<string, unknown>,
    evidenceHash: string | null,
    sourceMode: string | null,
    observationId: string | null = null,
    candidateFactId: string | null = null,
  ) {
    const payloadHash = eventPayloadHash(eventType, payload, evidenceHash);
    const existing = await this.findEvent(session.id, eventKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new ConflictException('Session event key cannot be reused with different evidence');
      return { ...existing, duplicate: true };
    }
    const id = newId();
    try {
      await this.db.insert(appReadSessionEvents).values({
        id, sessionId: session.id, userId: session.userId, eventKey, eventType, sourceMode,
        packageName: typeof payload.packageName === 'string' ? payload.packageName : session.targetPackage,
        payloadHash, evidenceHash, payloadJson: payload, observationId, candidateFactId, createdAt: new Date(),
      });
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      const raced = await this.findEvent(session.id, eventKey);
      if (!raced || raced.payloadHash !== payloadHash) {
        throw new ConflictException('Session event key cannot be reused with different evidence');
      }
      return { ...raced, duplicate: true };
    }
    return { id, duplicate: false };
  }

  private findEvent(sessionId: string, eventKey: string) {
    return this.db.select().from(appReadSessionEvents)
      .where(and(eq(appReadSessionEvents.sessionId, sessionId), eq(appReadSessionEvents.eventKey, eventKey)))
      .limit(1).then((rows) => rows[0]);
  }

  private async assertActiveSession(userId: string, id: string, signedDeviceId: string) {
    const row = await this.getRow(userId, id);
    if (row.trustedDeviceId !== signedDeviceId) throw new ForbiddenException('Session request was signed by a different device');
    if (!ACTIVE.has(row.status as AppReadSessionStatus) || !row.activeDeviceKey) {
      throw new ConflictException('App read session is no longer active');
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.terminate(row, 'TIMEOUT', 'SESSION_EXPIRED');
      throw new ConflictException('App read session has expired');
    }
    return row;
  }

  private getRow(userId: string, id: string) {
    return this.db.select().from(appReadSessions)
      .where(and(eq(appReadSessions.id, id), eq(appReadSessions.userId, userId))).limit(1)
      .then((rows) => {
        if (!rows[0]) throw new NotFoundException('App read session not found');
        return rows[0];
      });
  }

  private async terminate(session: typeof appReadSessions.$inferSelect, status: AppReadSessionStatus, reason: string) {
    if (!APP_READ_SESSION_TERMINAL_STATUSES.has(status)) throw new Error('terminate requires a terminal status');
    await this.db.update(appReadSessions).set({
      status, activeDeviceKey: null, endedAt: new Date(), terminalReason: reason.slice(0, 120), updatedAt: new Date(),
    }).where(and(eq(appReadSessions.id, session.id), eq(appReadSessions.userId, session.userId)));
  }

  private async expireActiveForDevice(deviceId: string) {
    const rows = await this.db.select().from(appReadSessions).where(eq(appReadSessions.activeDeviceKey, deviceId));
    for (const row of rows) {
      if (row.expiresAt.getTime() <= Date.now()) await this.terminate(row, 'TIMEOUT', 'SESSION_EXPIRED');
    }
  }

  private async expireForUser(userId: string) {
    const rows = await this.db.select().from(appReadSessions)
      .where(and(eq(appReadSessions.userId, userId), isNotNull(appReadSessions.activeDeviceKey)));
    for (const row of rows) {
      if (row.expiresAt.getTime() <= Date.now()) await this.terminate(row, 'TIMEOUT', 'SESSION_EXPIRED');
    }
  }

  private response(session: typeof appReadSessions.$inferSelect, events: (typeof appReadSessionEvents.$inferSelect)[]): AppReadSessionResponse {
    return {
      id: session.id,
      connectionId: session.deviceAppConnectionId,
      trustedDeviceId: session.trustedDeviceId,
      targetPackage: session.targetPackage,
      modes: session.modesJson,
      status: session.status,
      correlationId: session.correlationId,
      startedAt: session.startedAt?.toISOString() ?? null,
      lastHeartbeatAt: session.lastHeartbeatAt?.toISOString() ?? null,
      expiresAt: session.expiresAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      terminalReason: session.terminalReason,
      events: events.map((event) => ({
        id: event.id,
        eventKey: event.eventKey,
        eventType: event.eventType,
        sourceMode: event.sourceMode,
        packageName: event.packageName,
        observationId: event.observationId,
        candidateFactId: event.candidateFactId,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }
}

function validObservedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 2 * 60 * 1000 || Date.now() - date.getTime() > 17 * 60 * 1000) {
    throw new BadRequestException('observedAt is invalid or stale');
  }
  return date;
}

function eventPayloadHash(eventType: AppReadSessionEventType, payload: Record<string, unknown>, evidenceHash: string | null) {
  return realityValueHash({ eventType, payload: payload as never, evidenceHash });
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function isDuplicate(error: unknown) {
  let current = error;
  for (let index = 0; index < 5 && current && typeof current === 'object'; index += 1) {
    const candidate = current as { code?: string; cause?: unknown };
    if (candidate.code === 'ER_DUP_ENTRY') return true;
    current = candidate.cause;
  }
  return false;
}
