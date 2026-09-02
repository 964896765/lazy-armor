import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorsService } from '../connectors/connectors.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { currentAppRole, workerEnabled } from '../common/app-role';
import { DiagnosticsService } from '../diagnostics/diagnostics.service';
import { executions, outboxMessages } from '@lazy-armor/database';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, max, min, or } from 'drizzle-orm';
import { QueueService } from '../infrastructure/queue.service';
import { EXECUTION_WORKER, OUTBOX_WORKER } from '../execution/execution.module';

type WorkerStatus = 'UP' | 'DEGRADED' | 'DOWN';
type OperationalHealth = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN' | 'NOT_APPLICABLE';

interface WorkerProbeResponse {
  status: 'ready' | 'not_ready';
  role: string;
  checkedAt?: string;
  mysql?: string;
  redis?: string;
  bullmq?: string;
  queueCounts?: Record<string, number>;
  worker?: { ready?: boolean; reason?: string | null };
  reason?: string | null;
}

interface WorkerLiveResponse {
  status: 'ok';
  role: string;
  checkedAt?: string;
}

@Injectable()
export class AdminOperationsService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly config: ConfigService,
    private readonly diagnostics: DiagnosticsService,
    private readonly queue: QueueService,
    private readonly connectors: ConnectorsService,
    @Optional() @Inject(EXECUTION_WORKER) private readonly executionWorker?: { readiness(): Promise<{ ready: boolean; reason: string | null }> },
    @Optional() @Inject(OUTBOX_WORKER) private readonly outboxWorker?: { readiness(): { ready: boolean; reason: string | null } },
  ) {}

  async overview() {
    const [snapshot, workers, outbox, executionOverview, connectorHealth] = await Promise.all([
      this.diagnostics.snapshot(),
      this.workers(),
      this.outbox(),
      this.executions(),
      this.connectorsSummary(),
    ]);
    const statuses = [workers.executionWorker.status, workers.outboxWorker.status];
    const status: WorkerStatus = statuses.includes('DOWN')
      ? 'DOWN'
      : statuses.includes('DEGRADED')
        ? 'DEGRADED'
        : 'UP';
    return {
      status,
      generatedAt: snapshot.generatedAt,
      execution: {
        active: snapshot.activeExecutions,
        failed24h: snapshot.failedExecutions24h,
        waitingApproval: snapshot.waitingApproval,
        waitingDispatch: snapshot.waitingDispatch,
        stuck: snapshot.stuckExecutions,
      },
      delivery: {
        pendingOutbox: snapshot.pendingOutbox,
        deadOutbox: snapshot.deadOutbox,
        outcomeUnknown: snapshot.outcomeUnknown,
        retryWait: outbox.retryWaitCount,
      },
      credentials: {
        staleCredentials: snapshot.staleCredentials,
      },
      workers,
      connectors: {
        total: connectorHealth.items.length,
        productionReady: connectorHealth.items.filter((item) => item.productionGateStatus === 'PRODUCTION_READY').length,
        beta: connectorHealth.items.filter((item) => item.productionGateStatus === 'BETA').length,
        draftOnly: connectorHealth.items.filter((item) => item.productionGateStatus === 'DRAFT_ONLY').length,
        disabled: connectorHealth.items.filter((item) => item.productionGateStatus === 'DISABLED').length,
      },
      topIssues: {
        recentFailedExecutions: executionOverview.recentFailed.length,
        recentDeadOutbox: outbox.recentFailures.length,
        stuckExecutions: executionOverview.stuck.length,
      },
    };
  }

  async workers() {
    const [executionWorker, outboxWorker] = await Promise.all([
      this.workerSummary('execution-worker'),
      this.workerSummary('outbox-worker'),
    ]);
    return { generatedAt: new Date().toISOString(), executionWorker, outboxWorker };
  }

  async outbox() {
    const now = new Date();
    const [countsRow, oldestPendingRow, recentFailures] = await Promise.all([
      this.db.select({
        deadCount: count(outboxMessages.id),
      }).from(outboxMessages).where(eq(outboxMessages.status, 'dead')),
      this.db.select({
        oldestPendingAt: min(outboxMessages.nextAttemptAt),
      }).from(outboxMessages).where(or(eq(outboxMessages.status, 'pending'), eq(outboxMessages.status, 'retry_wait'))),
      this.db.select({
        id: outboxMessages.id,
        aggregateType: outboxMessages.aggregateType,
        eventType: outboxMessages.eventType,
        destination: outboxMessages.destination,
        status: outboxMessages.status,
        attemptCount: outboxMessages.attemptCount,
        lastErrorCode: outboxMessages.lastErrorCode,
        updatedAt: outboxMessages.updatedAt,
      }).from(outboxMessages)
        .where(inArray(outboxMessages.status, ['dead', 'retry_wait']))
        .orderBy(desc(outboxMessages.updatedAt))
        .limit(10),
    ]);
    const [pendingCount, retryWaitCount] = await Promise.all([
      this.countOutboxStatus('pending'),
      this.countOutboxStatus('retry_wait'),
    ]);
    return {
      generatedAt: now.toISOString(),
      deadCount: Number(countsRow[0]?.deadCount ?? 0),
      pendingCount,
      retryWaitCount,
      oldestPendingAt: oldestPendingRow[0]?.oldestPendingAt?.toISOString() ?? null,
      oldestPendingAgeSeconds: ageSeconds(oldestPendingRow[0]?.oldestPendingAt ?? null, now),
      recentFailures: recentFailures.map((row) => ({
        id: row.id,
        aggregateType: row.aggregateType,
        eventType: row.eventType,
        destination: row.destination,
        status: row.status,
        attemptCount: row.attemptCount,
        lastErrorCode: row.lastErrorCode,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async executions() {
    const now = new Date();
    const [recentFailed, stuck] = await Promise.all([
      this.db.select({
        id: executions.id,
        planId: executions.planId,
        status: executions.status,
        errorCode: executions.errorCode,
        resultCode: executions.resultCode,
        updatedAt: executions.updatedAt,
      }).from(executions)
        .where(and(eq(executions.status, 'failed'), gte(executions.updatedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))))
        .orderBy(desc(executions.updatedAt))
        .limit(10),
      this.db.select({
        id: executions.id,
        planId: executions.planId,
        workerToken: executions.workerToken,
        heartbeatAt: executions.heartbeatAt,
        leaseExpiresAt: executions.leaseExpiresAt,
        updatedAt: executions.updatedAt,
      }).from(executions)
        .where(and(eq(executions.status, 'running'), lt(executions.leaseExpiresAt, now)))
        .orderBy(asc(executions.leaseExpiresAt))
        .limit(10),
    ]);
    return {
      generatedAt: now.toISOString(),
      recentFailed: recentFailed.map((row) => ({
        id: row.id,
        planId: row.planId,
        status: row.status,
        errorCode: row.errorCode,
        resultCode: row.resultCode,
        updatedAt: row.updatedAt.toISOString(),
      })),
      stuck: stuck.map((row) => ({
        id: row.id,
        planId: row.planId,
        workerLease: row.workerToken,
        lastHeartbeatAt: row.heartbeatAt?.toISOString() ?? null,
        leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
        stuckDurationSeconds: ageSeconds(row.leaseExpiresAt ?? row.updatedAt, now),
      })),
    };
  }

  async connectorsSummary() {
    const items = this.connectors.listInternal().map((connector) => {
      const capabilityAvailability = connector.capabilities.reduce<Record<string, number>>((acc, capability) => {
        const key = capability.providerAvailability?.toUpperCase?.() ?? 'UNKNOWN';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
      const operationalHealth: OperationalHealth = connector.supportsHealthCheck
        ? 'UNKNOWN'
        : 'NOT_APPLICABLE';
      return {
        provider: connector.name,
        providerKey: connector.key,
        providerType: connector.providerType,
        operationalHealth,
        productionGateStatus: connector.productionStatus,
        capabilityAvailability,
        rateLimitStrategy: connector.rateLimitStrategy ?? 'none',
        supportsHealthCheck: connector.supportsHealthCheck,
      };
    });
    return { generatedAt: new Date().toISOString(), items };
  }

  private async workerSummary(role: 'execution-worker' | 'outbox-worker') {
    const now = new Date();
    const probe = await this.fetchWorkerProbe(role);
    const db = role === 'execution-worker'
      ? await this.executionWorkerDb(now)
      : await this.outboxWorkerDb(now);
    const probeReady = probe.ready?.status === 'ready';
    const probeLive = probe.live?.status === 'ok';
    const inProcess = await this.inProcessWorker(role);
    const live = probeLive || inProcess.live;
    const ready = probeReady || inProcess.ready;
    const status: WorkerStatus = !live ? 'DOWN' : ready ? 'UP' : 'DEGRADED';
    const checkedAt = probe.ready?.checkedAt ?? probe.live?.checkedAt ?? now.toISOString();
    const processHeartbeatAt = probe.live?.checkedAt ?? probe.ready?.checkedAt ?? (inProcess.live ? now.toISOString() : null);
    return {
      role,
      status,
      processStatus: live ? 'UP' : 'DOWN',
      liveness: live ? 'UP' : 'DOWN',
      readiness: {
        status: ready ? 'ready' : 'not_ready',
        mysql: probe.ready?.mysql ?? (inProcess.live ? 'ready' : 'unknown'),
        redis: probe.ready?.redis ?? 'unknown',
        bullmq: probe.ready?.bullmq ?? 'unknown',
        reason: probe.ready?.worker?.reason ?? probe.ready?.reason ?? inProcess.reason ?? null,
      },
      processHeartbeatAt,
      lastProbeSuccessAt: probe.ready?.checkedAt ?? probe.live?.checkedAt ?? null,
      lastWorkActivityAt: db.lastWorkActivityAt,
      workActivityAgeSeconds: ageSeconds(db.lastWorkActivityAt ? new Date(db.lastWorkActivityAt) : null, now),
      // Legacy aliases kept for compatibility while Operations UI migrates to process/work split fields.
      lastHeartbeatAt: db.lastWorkActivityAt,
      heartbeatAgeSeconds: ageSeconds(db.lastWorkActivityAt ? new Date(db.lastWorkActivityAt) : null, now),
      queueBacklog: db.queueBacklog,
      oldestPendingAgeSeconds: db.oldestPendingAgeSeconds,
      activeWork: db.activeWork,
      failureCount: db.failureCount,
      recentFailures: db.recentFailures,
      probeCheckedAt: checkedAt,
    };
  }

  private async executionWorkerDb(now: Date) {
    const [latestHeartbeat, runningCount, oldestPending, recentFailed] = await Promise.all([
      this.db.select({ lastHeartbeatAt: max(executions.heartbeatAt) }).from(executions).where(eq(executions.status, 'running')),
      this.db.select({ n: count(executions.id) }).from(executions).where(eq(executions.status, 'running')),
      this.db.select({ oldestQueuedAt: min(executions.queuedAt) }).from(executions).where(inArray(executions.status, ['queued', 'retry_wait', 'waiting_dispatch', 'waiting_approval'])),
      this.db.select({ errorCode: executions.errorCode, updatedAt: executions.updatedAt }).from(executions)
        .where(and(eq(executions.status, 'failed'), gte(executions.updatedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))))
        .orderBy(desc(executions.updatedAt))
        .limit(5),
    ]);
    const queueCounts = await this.safeQueueHealth();
    const backlog = queueCounts ? Number(queueCounts.waiting ?? 0) + Number(queueCounts.delayed ?? 0) : 0;
    return {
      lastHeartbeatAt: latestHeartbeat[0]?.lastHeartbeatAt?.toISOString() ?? null,
      lastWorkActivityAt: latestHeartbeat[0]?.lastHeartbeatAt?.toISOString() ?? null,
      queueBacklog: backlog,
      oldestPendingAgeSeconds: ageSeconds(oldestPending[0]?.oldestQueuedAt ?? null, now),
      activeWork: Number(runningCount[0]?.n ?? 0),
      failureCount: recentFailed.length,
      recentFailures: recentFailed.map((row) => ({ errorCode: row.errorCode, updatedAt: row.updatedAt.toISOString() })),
    };
  }

  private async outboxWorkerDb(now: Date) {
    const [latestActivity, activeLocks, oldestPending, recentDead] = await Promise.all([
      this.db.select({ lastUpdatedAt: max(outboxMessages.updatedAt) }).from(outboxMessages).where(isNotNull(outboxMessages.lockedBy)),
      this.db.select({ n: count(outboxMessages.id) }).from(outboxMessages).where(isNotNull(outboxMessages.lockedBy)),
      this.db.select({ oldestPendingAt: min(outboxMessages.nextAttemptAt) }).from(outboxMessages).where(or(eq(outboxMessages.status, 'pending'), eq(outboxMessages.status, 'retry_wait'))),
      this.db.select({ lastErrorCode: outboxMessages.lastErrorCode, updatedAt: outboxMessages.updatedAt }).from(outboxMessages)
        .where(eq(outboxMessages.status, 'dead'))
        .orderBy(desc(outboxMessages.updatedAt))
        .limit(5),
    ]);
    const pendingCount = await this.countOutboxStatus('pending');
    const retryWaitCount = await this.countOutboxStatus('retry_wait');
    return {
      lastHeartbeatAt: latestActivity[0]?.lastUpdatedAt?.toISOString() ?? null,
      lastWorkActivityAt: latestActivity[0]?.lastUpdatedAt?.toISOString() ?? null,
      queueBacklog: pendingCount + retryWaitCount,
      oldestPendingAgeSeconds: ageSeconds(oldestPending[0]?.oldestPendingAt ?? null, now),
      activeWork: Number(activeLocks[0]?.n ?? 0),
      failureCount: recentDead.length,
      recentFailures: recentDead.map((row) => ({ errorCode: row.lastErrorCode, updatedAt: row.updatedAt.toISOString() })),
    };
  }

  private async fetchWorkerProbe(role: 'execution-worker' | 'outbox-worker') {
    const host = this.config.get<string>('WORKER_PROBE_HOST') ?? '127.0.0.1';
    const port = this.config.get<number>(role === 'execution-worker' ? 'EXECUTION_WORKER_PROBE_PORT' : 'OUTBOX_WORKER_PROBE_PORT') ?? (role === 'execution-worker' ? 3011 : 3012);
    const base = `http://${host}:${port}`;
    const [live, ready] = await Promise.all([
      this.fetchJson<WorkerLiveResponse>(`${base}/live`),
      this.fetchJson<WorkerProbeResponse>(`${base}/ready`),
    ]);
    return { live, ready };
  }

  private async inProcessWorker(role: 'execution-worker' | 'outbox-worker') {
    if (!workerEnabled(role)) return { live: false, ready: false, reason: 'worker_disabled' };
    const current = currentAppRole();
    if (current !== 'all' && current !== role) return { live: false, ready: false, reason: 'worker_not_running_in_this_process' };
    if (role === 'execution-worker') {
      const readiness = this.executionWorker ? await this.executionWorker.readiness() : { ready: false, reason: 'execution_worker_not_available' };
      return { live: true, ready: readiness.ready, reason: readiness.reason };
    }
    const readiness = this.outboxWorker ? this.outboxWorker.readiness() : { ready: false, reason: 'outbox_worker_not_available' };
    return { live: true, ready: readiness.ready, reason: readiness.reason };
  }

  private async safeQueueHealth() {
    try {
      return (await this.queue.health()).counts;
    } catch {
      return null;
    }
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 400);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) return null;
      return await response.json() as T;
    } catch {
      return null;
    }
  }

  private async countOutboxStatus(status: 'pending' | 'retry_wait') {
    const rows = await this.db.select({ n: count(outboxMessages.id) }).from(outboxMessages).where(eq(outboxMessages.status, status));
    return Number(rows[0]?.n ?? 0);
  }
}

function ageSeconds(at: Date | null, now: Date) {
  if (!at) return null;
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
}
