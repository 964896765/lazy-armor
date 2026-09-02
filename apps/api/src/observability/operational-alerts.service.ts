import { Injectable } from '@nestjs/common';
import { AdminOperationsService } from '../admin/admin-operations.service';

type AlertSeverity = 'critical' | 'high' | 'medium';
type AlertStatus = 'firing' | 'clear';

export interface OperationalAlert {
  code: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  summary: string;
  metric: string | null;
  currentValue: number | string | null;
  threshold: number | string | null;
}

export interface OperationalAlertsSnapshot {
  generatedAt: string;
  overallStatus: 'critical' | 'degraded' | 'healthy';
  alerts: OperationalAlert[];
  notifyOnly: true;
  automaticRecovery: 'disabled';
  riskBypass: false;
  approvalBypass: false;
  runtimePermissionBypass: false;
  connectorHealth: Array<{
    providerKey: string;
    productionGateStatus: string;
    operationalHealth: string;
  }>;
}

@Injectable()
export class OperationalAlertsService {
  constructor(private readonly operations: AdminOperationsService) {}

  async list(): Promise<OperationalAlertsSnapshot> {
    const [overview, workers, outbox, executions, connectors] = await Promise.all([
      this.operations.overview(),
      this.operations.workers(),
      this.operations.outbox(),
      this.operations.executions(),
      this.operations.connectorsSummary(),
    ]);

    const alerts: OperationalAlert[] = [
      this.rule('WORKER_DOWN', 'critical', workers.executionWorker.processStatus === 'DOWN' || workers.outboxWorker.processStatus === 'DOWN', 'Worker 已停止', '至少一个 Worker 进程不可用。', 'worker.processStatus', workers.executionWorker.processStatus === 'DOWN' ? 'execution-worker' : workers.outboxWorker.processStatus === 'DOWN' ? 'outbox-worker' : null, 'UP'),
      this.rule('READINESS_DEGRADED', 'high', workers.executionWorker.readiness.status !== 'ready' || workers.outboxWorker.readiness.status !== 'ready', 'Worker 就绪降级', '至少一个 Worker readiness 不是 ready。', 'worker.readiness', workers.executionWorker.readiness.status !== 'ready' ? workers.executionWorker.readiness.reason : workers.outboxWorker.readiness.reason, 'ready'),
      this.rule('DB_UNAVAILABLE', 'critical', overview.dataStatus === 'unavailable', '数据库不可用', 'Operations 聚合无法读取数据库状态。', 'operations.dataStatus', overview.dataStatus, 'available'),
      this.rule('REDIS_UNAVAILABLE', 'high', workers.executionWorker.readiness.redis === 'not_ready' || workers.outboxWorker.readiness.redis === 'not_ready', 'Redis 不可用', '至少一个 Worker 的 Redis readiness 失败。', 'worker.redis', workers.executionWorker.readiness.redis === 'not_ready' ? 'execution-worker' : workers.outboxWorker.readiness.redis === 'not_ready' ? 'outbox-worker' : null, 'ready'),
      this.rule('QUEUE_BACKLOG', 'medium', Number(workers.executionWorker.queueBacklog ?? 0) >= 20, '队列积压升高', 'Execution queue backlog 超过阈值。', 'queue.waiting', Number(workers.executionWorker.queueBacklog ?? 0), 20),
      this.rule('QUEUE_OLDEST_AGE', 'medium', Number(workers.executionWorker.oldestPendingAgeSeconds ?? 0) >= 300, '队列等待过久', 'Execution queue 最老等待时间超过阈值。', 'queue.oldest_age', Number(workers.executionWorker.oldestPendingAgeSeconds ?? 0), 300),
      this.rule('STUCK_EXECUTION', 'high', executions.stuck.length > 0, '存在卡住的执行', '发现 lease 过期但仍处于 running 的执行。', 'execution.stuck', executions.stuck.length, 0),
      this.rule('DEAD_OUTBOX', 'high', Number(outbox.deadCount ?? 0) > 0, '存在 dead outbox', '至少有一条 outbox 消息已进入 dead letter。', 'outbox.dead', Number(outbox.deadCount ?? 0), 0),
      this.rule('OUTCOME_UNKNOWN', 'critical', Number(overview.delivery.outcomeUnknown ?? 0) > 0, '存在 outcome_unknown', '发现需要人工确认的外部副作用。', 'outbox.outcome_unknown', Number(overview.delivery.outcomeUnknown ?? 0), 0),
      this.rule('PROVIDER_TIMEOUT_SPIKE', 'medium', this.matchFailures(outbox.recentFailures, ['TIMEOUT']) >= 3 || executions.recentFailed.filter((item) => item.errorCode === 'TIMEOUT').length >= 3, 'Provider timeout 增长', '最近失败中 timeout 已达到告警阈值。', 'connector.timeout', this.matchFailures(outbox.recentFailures, ['TIMEOUT']) + executions.recentFailed.filter((item) => item.errorCode === 'TIMEOUT').length, 3),
      this.rule('PROVIDER_5XX_SPIKE', 'medium', this.matchFailures(outbox.recentFailures, ['PROVIDER_5XX']) >= 3 || executions.recentFailed.filter((item) => item.errorCode === 'PROVIDER_5XX').length >= 3, 'Provider 5xx 增长', '最近失败中 provider 5xx 已达到告警阈值。', 'connector.provider_5xx', this.matchFailures(outbox.recentFailures, ['PROVIDER_5XX']) + executions.recentFailed.filter((item) => item.errorCode === 'PROVIDER_5XX').length, 3),
      this.rule('CREDENTIAL_FAILURE_SPIKE', 'medium', this.matchFailures(executions.recentFailed, ['CREDENTIAL_INVALID', 'CREDENTIAL_EXPIRED']) >= 3, '连接凭据失败增多', '最近执行失败中的凭据错误达到阈值。', 'connector.auth_failure', this.matchFailures(executions.recentFailed, ['CREDENTIAL_INVALID', 'CREDENTIAL_EXPIRED']), 3),
    ];

    return {
      generatedAt: new Date().toISOString(),
      overallStatus: alerts.some((item) => item.status === 'firing' && item.severity === 'critical')
        ? 'critical'
        : alerts.some((item) => item.status === 'firing')
          ? 'degraded'
          : 'healthy',
      alerts,
      notifyOnly: true,
      automaticRecovery: 'disabled',
      riskBypass: false,
      approvalBypass: false,
      runtimePermissionBypass: false,
      connectorHealth: connectors.items.map((item) => ({
        providerKey: item.providerKey,
        productionGateStatus: item.productionGateStatus,
        operationalHealth: item.operationalHealth,
      })),
    };
  }

  private rule(
    code: string,
    severity: AlertSeverity,
    firing: boolean,
    title: string,
    summary: string,
    metric: string | null,
    currentValue: number | string | null,
    threshold: number | string | null,
  ): OperationalAlert {
    return { code, severity, status: firing ? 'firing' : 'clear', title, summary, metric, currentValue, threshold };
  }

  private matchFailures(items: Array<{ errorCode?: string | null; lastErrorCode?: string | null }>, codes: string[]) {
    return items.filter((item) => codes.includes(item.errorCode ?? item.lastErrorCode ?? '')).length;
  }
}
