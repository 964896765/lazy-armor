export type TodoType = 'APPROVAL' | 'CONFIRMATION' | 'EXCEPTION' | 'VERIFICATION';
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

export type TodoFilter = 'ALL' | TodoType;
export type TodoTab = 'OPEN' | 'COMPLETED' | 'ALL';

export const TODO_FILTERS: TodoFilter[] = ['ALL', 'APPROVAL', 'CONFIRMATION', 'EXCEPTION', 'VERIFICATION'];

export function todoTypeLabel(type: TodoType): string {
  switch (type) {
    case 'APPROVAL': return '待审批';
    case 'CONFIRMATION': return '待确认';
    case 'EXCEPTION': return '待处理异常';
    case 'VERIFICATION': return '待核实';
  }
}

export function todoFilterLabel(filter: TodoFilter): string {
  return filter === 'ALL' ? '全部' : todoTypeLabel(filter);
}

export function todoStatusLabel(status: TodoStatus): string {
  return status === 'OPEN' ? '待处理' : '已完成';
}

/** 跳转沿用既有详情页；审批/对账/执行/连接详情页都是权威页面，绝不伪造状态。 */
export function todoRoute(item: TodoItem): string | null {
  switch (item.type) {
    case 'APPROVAL':
      return item.approvalRequestId ? `/approvals/${item.approvalRequestId}` : '/approvals';
    case 'VERIFICATION':
      return item.reconciliationCaseId ? `/reconciliation/${item.reconciliationCaseId}` : item.executionId ? `/executions/${item.executionId}` : '/records';
    case 'EXCEPTION':
      return item.connectionId ? `/connections/${item.connectionId}` : item.executionId ? `/executions/${item.executionId}` : '/records';
    case 'CONFIRMATION':
      return item.executionId ? `/executions/${item.executionId}` : '/records';
  }
}

export function filterTodos(items: TodoItem[], tab: TodoTab, filter: TodoFilter): TodoItem[] {
  return items.filter((item) => {
    if (tab !== 'ALL' && item.status !== tab) return false;
    if (filter !== 'ALL' && item.type !== filter) return false;
    return true;
  });
}

export function openTodoCount(items: TodoItem[]): number {
  return items.filter((item) => item.status === 'OPEN').length;
}

export function todoTone(type: TodoType): 'danger' | 'warning' | 'brand' {
  switch (type) {
    case 'APPROVAL':
    case 'CONFIRMATION':
      return 'danger';
    case 'EXCEPTION':
      return 'warning';
    case 'VERIFICATION':
      return 'warning';
  }
}

export function todoIcon(type: TodoType): string {
  switch (type) {
    case 'APPROVAL': return 'checkmark-done-outline';
    case 'CONFIRMATION': return 'shield-checkmark-outline';
    case 'EXCEPTION': return 'alert-circle-outline';
    case 'VERIFICATION': return 'search-outline';
  }
}

export function todoSource(item: TodoItem): string {
  return item.planName ?? '执行记录';
}
