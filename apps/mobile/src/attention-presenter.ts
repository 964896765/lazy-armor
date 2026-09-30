import { connectionStatusLabel } from './connection-presenter';
import { notificationDeepLink } from './consumer-error-presenter';
import { executionStatusLabel } from './execution-presenter';
import { reconciliationStatusLabel } from './verification-presenter';

export interface AttentionApproval { id: string; planName: string; summary: string; riskLevel: string; expiresAt: string }
export interface AttentionConnectionIssue { connectionId: string; connectionStatus: string; providerName: string; planName: string }
export interface AttentionAlert {
  id: string; priority: string; title: string; body: string;
  executionId?: string; approvalRequestId?: string | null; connectionId?: string | null;
  reconciliationCaseId?: string | null; eventType?: string | null; createdAt: string;
  category?: 'attention' | 'exception' | 'summary';
}
export interface AttentionProcessed { id: string; status: string; resultSummary: string | null; finishedAt: string | null; planName: string }
export interface AttentionToday {
  pendingApprovals: AttentionApproval[]; connectionIssues: AttentionConnectionIssue[];
  alerts: AttentionAlert[]; processed: AttentionProcessed[];
}
export interface AttentionReconciliation {
  id: string; status: 'OPEN' | 'RECONCILING' | 'RESOLVED' | 'NEEDS_USER';
  resultState: string; attemptCount: number; executionId: string; createdAt: string; updatedAt: string; expiresAt: string;
}

export type AttentionTone = 'danger' | 'warning' | 'brand';

export interface AttentionRow {
  id: string;
  icon: string;
  source: string;
  title: string;
  status: string;
  meta: string;
  tone: AttentionTone;
  route: string | null;
}

export interface AttentionSection { key: string; title: string; rows: AttentionRow[] }

export function buildAttentionSections(today: AttentionToday | undefined, reconciliation: AttentionReconciliation[]): AttentionSection[] {
  const alerts = (today?.alerts ?? []).map((item) => ({ ...item, section: classifyAlert(item) }));
  const decision: AttentionRow[] = [
    ...(today?.pendingApprovals ?? []).map((item) => ({
      id: `approval:${item.id}`,
      icon: 'checkmark-done-outline',
      source: item.planName,
      title: item.summary,
      status: '需要你确认',
      meta: formatExpiry(item.expiresAt),
      tone: 'danger' as const,
      route: `/approvals/${item.id}`,
    })),
    ...reconciliation.filter((item) => item.status === 'NEEDS_USER').map((item) => ({
      id: `reconcile:${item.id}`,
      icon: 'help-circle-outline',
      source: '执行结果',
      title: '结果暂时无法确认',
      status: '需要你核实实际结果',
      meta: formatAttentionTime(item.updatedAt ?? item.createdAt),
      tone: 'danger' as const,
      route: `/reconciliation/${item.id}`,
    })),
  ];
  const exception: AttentionRow[] = [
    ...(today?.connectionIssues ?? []).map((item) => ({
      id: `connection:${item.connectionId}:${item.planName}`,
      icon: 'refresh-outline',
      source: item.providerName,
      title: `${connectionStatusLabel(item.connectionStatus)} · ${item.planName}`,
      status: '连接或授权需处理',
      meta: '',
      tone: 'warning' as const,
      route: `/connections/${item.connectionId}`,
    })),
    ...alerts.filter((item) => item.section === 'exception').map((item) => alertRow(item, 'danger')),
  ];
  const reminder: AttentionRow[] = alerts.filter((item) => item.section === 'attention').map((item) => alertRow(item, 'warning'));
  const outcome: AttentionRow[] = reconciliation.filter((item) => item.status === 'OPEN' || item.status === 'RECONCILING').map((item) => ({
    id: `reconcile:${item.id}`,
    icon: 'search-outline',
    source: '执行结果',
    title: '结果暂时无法确认',
    status: reconciliationStatusLabel(item.status),
    meta: formatAttentionTime(item.updatedAt ?? item.createdAt),
    tone: 'warning' as const,
    route: `/reconciliation/${item.id}`,
  }));
  const done: AttentionRow[] = [
    ...(today?.processed ?? []).map((item) => ({
      id: `result:${item.id}`,
      icon: 'checkmark-circle-outline',
      source: item.planName,
      title: item.resultSummary ?? executionStatusLabel(item.status),
      status: '已完成',
      meta: formatAttentionTime(item.finishedAt),
      tone: 'brand' as const,
      route: `/executions/${item.id}`,
    })),
    ...alerts.filter((item) => item.section === 'summary').map((item) => alertRow(item, 'brand')),
  ];

  const sections: AttentionSection[] = [
    { key: 'decision', title: '需要决定', rows: decision },
    { key: 'exception', title: '异常', rows: exception },
    { key: 'reminder', title: '提醒', rows: reminder },
    { key: 'outcome', title: '结果待确认', rows: outcome },
    { key: 'done', title: '已完成', rows: done },
  ];
  return sections.filter((section) => section.rows.length > 0);
}

/** Number of rows that genuinely need the user to do something (excludes completed). */
export function attentionNeedsCount(today: AttentionToday | undefined, reconciliation: AttentionReconciliation[]): number {
  return buildAttentionSections(today, reconciliation)
    .filter((section) => section.key !== 'done')
    .reduce((sum, section) => sum + section.rows.length, 0);
}

function alertRow(item: AttentionAlert & { section: 'attention' | 'exception' | 'summary' }, tone: AttentionTone): AttentionRow {
  const route = notificationDeepLink({
    eventType: item.eventType ?? null,
    executionId: item.executionId,
    approvalRequestId: item.approvalRequestId,
    connectionId: item.connectionId,
    reconciliationCaseId: item.reconciliationCaseId,
  });
  return {
    id: `alert:${item.id}`,
    icon: item.section === 'exception' ? 'alert-circle-outline' : 'information-circle-outline',
    source: '系统提醒',
    title: item.title,
    status: item.section === 'exception' ? '异常' : item.section === 'summary' ? '已完成' : '提醒',
    meta: formatAttentionTime(item.createdAt),
    tone,
    route,
  };
}

function classifyAlert(item: AttentionAlert): 'attention' | 'exception' | 'summary' {
  if (item.category) return item.category;
  const normalized = `${item.title} ${item.body}`.toLowerCase();
  if (item.priority === 'P0' || normalized.includes('需要你') || normalized.includes('等待你') || normalized.includes('重新连接') || normalized.includes('重新授权') || normalized.includes('确认')) return 'attention';
  if (item.priority === 'P2' || normalized.includes('摘要') || normalized.includes('重点')) return 'summary';
  return 'exception';
}

function formatExpiry(value: string) {
  return `${new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 前有效`;
}

function formatAttentionTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
