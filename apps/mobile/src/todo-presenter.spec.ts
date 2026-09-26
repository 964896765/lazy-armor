import { describe, expect, it } from 'vitest';
import {
  filterTodos,
  openTodoCount,
  todoRoute,
  todoTypeLabel,
  type TodoItem,
} from './todo-presenter';

const todo = (overrides: Partial<TodoItem> = {}): TodoItem => ({
  id: 'x',
  type: 'APPROVAL',
  sourceId: 'x',
  summary: '摘要',
  priority: 'P1',
  status: 'OPEN',
  createdAt: '2026-09-22T10:00:00.000Z',
  planId: null,
  planName: null,
  executionId: null,
  approvalRequestId: null,
  reconciliationCaseId: null,
  connectionId: null,
  ...overrides,
});

describe('todo presenter 类型映射', () => {
  it('maps the four todo types to their filter labels', () => {
    expect(todoTypeLabel('APPROVAL')).toBe('待审批');
    expect(todoTypeLabel('CONFIRMATION')).toBe('待确认');
    expect(todoTypeLabel('EXCEPTION')).toBe('待处理异常');
    expect(todoTypeLabel('VERIFICATION')).toBe('待核实');
  });

  it('routes approval/verification/execution/connection todos to existing detail pages', () => {
    expect(todoRoute(todo({ type: 'APPROVAL', approvalRequestId: 'a1' }))).toBe('/approvals/a1');
    expect(todoRoute(todo({ type: 'VERIFICATION', reconciliationCaseId: 'r1' }))).toBe('/reconciliation/r1');
    expect(todoRoute(todo({ type: 'CONFIRMATION', executionId: 'e1' }))).toBe('/executions/e1');
    expect(todoRoute(todo({ type: 'EXCEPTION', executionId: 'e1' }))).toBe('/executions/e1');
    expect(todoRoute(todo({ type: 'EXCEPTION', connectionId: 'c1' }))).toBe('/connections/c1');
  });
});

describe('todo presenter 过滤', () => {
  const items: TodoItem[] = [
    todo({ id: 'a', type: 'APPROVAL', status: 'OPEN' }),
    todo({ id: 'c', type: 'CONFIRMATION', status: 'OPEN' }),
    todo({ id: 'f', type: 'EXCEPTION', status: 'OPEN' }),
    todo({ id: 'v', type: 'VERIFICATION', status: 'OPEN' }),
    todo({ id: 'done', type: 'CONFIRMATION', status: 'COMPLETED' }),
  ];

  it('filters by status tab', () => {
    expect(filterTodos(items, 'OPEN', 'ALL').map((item) => item.id)).toEqual(['a', 'c', 'f', 'v']);
    expect(filterTodos(items, 'COMPLETED', 'ALL').map((item) => item.id)).toEqual(['done']);
    expect(filterTodos(items, 'ALL', 'ALL').length).toBe(5);
  });

  it('filters by type within the pending list', () => {
    expect(filterTodos(items, 'OPEN', 'APPROVAL').map((item) => item.id)).toEqual(['a']);
    expect(filterTodos(items, 'OPEN', 'EXCEPTION').map((item) => item.id)).toEqual(['f']);
  });

  it('counts only open todos', () => {
    expect(openTodoCount(items)).toBe(4);
    expect(openTodoCount([])).toBe(0);
  });
});
