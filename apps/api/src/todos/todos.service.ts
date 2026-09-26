import { Inject, Injectable } from '@nestjs/common';
import { approvalRequests, connections, connectors, executions, planVersions, reconciliationCases } from '@lazy-armor/database';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

export const TODO_TYPES = ['APPROVAL', 'CONFIRMATION', 'EXCEPTION', 'VERIFICATION'] as const;
export type TodoType = (typeof TODO_TYPES)[number];
export type TodoStatus = 'OPEN' | 'COMPLETED';

export interface TodoItem {
  id: string;
  type: TodoType;
  sourceId: string;
  summary: string;
  priority: string;
  status: TodoStatus;
  createdAt: string;
  planId: string | null;
  planName: string | null;
  executionId: string | null;
  approvalRequestId: string | null;
  reconciliationCaseId: string | null;
  connectionId: string | null;
}

// 与 NotificationService.today 使用同一份「连接异常」清单，只读展示，绝不改写连接状态机。
const CONNECTION_ISSUE_STATUSES = ['degraded', 'expired', 'permission_required', 'reauthorization_required', 'provider_error'];

/**
 * 统一待办中心的只读聚合。四类来源映射（与既有权威服务同过滤/同联表）：
 * - APPROVAL    ← approval_requests（pending=OPEN，approved/rejected/expired/cancelled=COMPLETED）
 * - CONFIRMATION← executions（waiting_approval / approvalStatus=pending = OPEN；终态成功/取消 = COMPLETED）
 * - EXCEPTION   ← 失败执行 + 连接异常（issueStatuses）
 * - VERIFICATION← reconciliation_cases（OPEN/NEEDS_USER = OPEN；RESOLVED = COMPLETED）
 * 写回（approve/reject/recheck）仍走原权威端点；本服务零写操作。
 */
@Injectable()
export class TodosService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async list(userId: string): Promise<TodoItem[]> {
    const [approvalRows, executionRows, reconciliationRows, issueRows] = await Promise.all([
      this.approvals(userId),
      this.executionList(userId),
      this.reconciliations(userId),
      this.connectionIssues(userId),
    ]);

    const items: TodoItem[] = [];

    for (const row of approvalRows) {
      const open = row.status === 'pending';
      items.push({
        id: `approval:${row.id}`,
        type: 'APPROVAL',
        sourceId: row.id,
        summary: row.actionSummary,
        priority: open ? approvalPriority(row.effectiveRiskLevel) : 'P3',
        status: open ? 'OPEN' : 'COMPLETED',
        createdAt: row.createdAt.toISOString(),
        planId: row.planId,
        planName: row.planName,
        executionId: row.executionId,
        approvalRequestId: row.id,
        reconciliationCaseId: null,
        connectionId: null,
      });
    }

    for (const row of executionRows) {
      const pendingConfirmation = row.status === 'waiting_approval' || row.approvalStatus === 'pending';
      const failed = row.status === 'failed';
      const terminal = ['succeeded', 'partially_succeeded', 'cancelled'].includes(row.status);
      if (pendingConfirmation) {
        items.push(executionTodo(row, 'CONFIRMATION', 'OPEN', 'P1'));
      } else if (failed) {
        items.push(executionTodo(row, 'EXCEPTION', 'OPEN', 'P1'));
      } else if (terminal) {
        items.push(executionTodo(row, 'CONFIRMATION', 'COMPLETED', 'P3'));
      }
      // 进行中（created/queued/running/retry_wait/waiting_dispatch）不是待办，跳过。
    }

    for (const row of reconciliationRows) {
      const open = row.status === 'OPEN' || row.status === 'NEEDS_USER';
      if (!open && row.status !== 'RESOLVED') continue; // RECONCILING 由 worker 处理，不进待办。
      items.push({
        id: `reconciliation:${row.id}`,
        type: 'VERIFICATION',
        sourceId: row.id,
        summary: '结果暂时无法确认',
        priority: open ? (row.status === 'NEEDS_USER' ? 'P1' : 'P2') : 'P3',
        status: open ? 'OPEN' : 'COMPLETED',
        createdAt: row.createdAt.toISOString(),
        planId: row.planId,
        planName: row.planName,
        executionId: row.executionId,
        approvalRequestId: null,
        reconciliationCaseId: row.id,
        connectionId: null,
      });
    }

    for (const row of issueRows) {
      items.push({
        id: `connection:${row.id}`,
        type: 'EXCEPTION',
        sourceId: row.id,
        summary: row.providerName,
        priority: 'P1',
        status: 'OPEN',
        createdAt: row.createdAt.toISOString(),
        planId: null,
        planName: null,
        executionId: null,
        approvalRequestId: null,
        reconciliationCaseId: null,
        connectionId: row.id,
      });
    }

    return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private approvals(userId: string) {
    return this.db.select({
      id: approvalRequests.id,
      executionId: approvalRequests.executionId,
      planId: approvalRequests.planId,
      planName: planVersions.name,
      status: approvalRequests.status,
      effectiveRiskLevel: approvalRequests.effectiveRiskLevel,
      actionSummary: approvalRequests.actionSummary,
      createdAt: approvalRequests.createdAt,
    }).from(approvalRequests)
      .innerJoin(planVersions, eq(approvalRequests.planVersionId, planVersions.id))
      .where(eq(approvalRequests.userId, userId))
      .orderBy(desc(approvalRequests.createdAt))
      .limit(500);
  }

  private executionList(userId: string) {
    return this.db.select({
      id: executions.id,
      planId: executions.planId,
      planName: planVersions.name,
      status: executions.status,
      approvalStatus: executions.approvalStatus,
      resultSummary: executions.resultSummary,
      createdAt: executions.createdAt,
    }).from(executions)
      .innerJoin(planVersions, eq(executions.planVersionId, planVersions.id))
      .where(eq(executions.userId, userId))
      .orderBy(desc(executions.createdAt))
      .limit(500);
  }

  private reconciliations(userId: string) {
    return this.db.select({
      id: reconciliationCases.id,
      executionId: reconciliationCases.executionId,
      planId: executions.planId,
      planName: planVersions.name,
      status: reconciliationCases.status,
      createdAt: reconciliationCases.createdAt,
    }).from(reconciliationCases)
      .innerJoin(executions, eq(reconciliationCases.executionId, executions.id))
      .innerJoin(planVersions, eq(executions.planVersionId, planVersions.id))
      .where(eq(reconciliationCases.userId, userId))
      .orderBy(desc(reconciliationCases.createdAt))
      .limit(500);
  }

  private connectionIssues(userId: string) {
    return this.db.select({
      id: connections.id,
      providerName: connectors.name,
      createdAt: connections.createdAt,
    }).from(connections)
      .innerJoin(connectors, eq(connections.connectorId, connectors.id))
      .where(and(eq(connections.userId, userId), inArray(connections.status, CONNECTION_ISSUE_STATUSES)))
      .orderBy(desc(connections.createdAt))
      .limit(200);
  }
}

interface ExecutionTodoRow {
  id: string;
  planId: string;
  planName: string;
  status: string;
  resultSummary: string | null;
  createdAt: Date;
}

function executionTodo(row: ExecutionTodoRow, type: TodoType, status: TodoStatus, priority: string): TodoItem {
  return {
    id: `execution:${row.id}`,
    type,
    sourceId: row.id,
    summary: row.resultSummary ?? row.status,
    priority,
    status,
    createdAt: row.createdAt.toISOString(),
    planId: row.planId,
    planName: row.planName,
    executionId: row.id,
    approvalRequestId: null,
    reconciliationCaseId: null,
    connectionId: null,
  };
}

function approvalPriority(risk: string | null): string {
  if (risk === 'R4') return 'P0';
  if (risk === 'R3') return 'P1';
  return 'P2';
}
