import { describe, expect, it } from 'vitest';
import {
  consumerErrorLabel,
  consumerErrorNextStep,
  notificationCategory,
  notificationCategoryLabel,
  notificationDeepLink,
} from './consumer-error-presenter';

describe('Consumer error presenter', () => {
  it('maps internal codes to consumer language', () => {
    expect(consumerErrorLabel('MCP_SCHEMA_CHANGED')).toBe('这个连接的能力发生了变化，需要重新确认');
    expect(consumerErrorLabel('RESULT_VERIFICATION_FAILED')).toBe('操作已经发出，但暂时无法确认结果');
    expect(consumerErrorLabel('TRUTH_VERSION_CONFLICT')).toBe('数据刚刚发生变化，请重新确认');
    expect(consumerErrorLabel('AUTH_REVOKED', '飞书')).toBe('飞书授权已失效，请重新连接');
    expect(consumerErrorLabel('DEVICE_OFFLINE')).toBe('你的手机当前不在线');
    expect(consumerErrorLabel('TRUTH_STALE')).toBe('数据有点旧，需要重新获取');
    expect(consumerErrorLabel('VERIFICATION_UNAVAILABLE')).toBe('已执行，但暂时无法确认结果');
  });

  it('keeps the advanced code out of the default copy', () => {
    expect(consumerErrorLabel('MCP_SCHEMA_CHANGED')).not.toContain('MCP_SCHEMA_CHANGED');
    expect(consumerErrorLabel('RESULT_VERIFICATION_FAILED')).not.toContain('RESULT_VERIFICATION_FAILED');
  });

  it('provides safe next steps', () => {
    expect(consumerErrorNextStep('RESULT_VERIFICATION_FAILED')).toContain('不要重复执行');
    expect(consumerErrorNextStep('AUTH_REVOKED')).toContain('重新连接');
  });

  it('classifies notification event types into the seven consumer categories', () => {
    expect(notificationCategory('approval_required')).toBe('NEEDS_CONFIRMATION');
    expect(notificationCategory('permission_revoked')).toBe('CONNECTION_INVALID');
    expect(notificationCategory('side_effect_outcome_unknown')).toBe('RESULT_PENDING');
    expect(notificationCategory('execution_failed')).toBe('EXECUTION_FAILED');
    expect(notificationCategory('device_offline')).toBe('DEVICE_OFFLINE');
    expect(notificationCategory('daily_summary_ready')).toBe('REMINDER');
    expect(notificationCategoryLabel('RESULT_PENDING')).toBe('结果待确认');
  });

  it('deep-links connection issues to the connection detail, never home', () => {
    expect(notificationDeepLink({ eventType: 'credential_revoked', connectionId: 'c1' })).toBe('/connections/c1');
    expect(notificationDeepLink({ eventType: 'permission_revoked' })).toBe('/connections');
  });

  it('deep-links approvals to approval detail', () => {
    expect(notificationDeepLink({ eventType: 'approval_required', approvalRequestId: 'a1' })).toBe('/approvals/a1');
    expect(notificationDeepLink({ eventType: 'approval_required' })).toBe('/approvals');
  });

  it('deep-links results to the record detail', () => {
    expect(notificationDeepLink({ eventType: 'side_effect_outcome_unknown', executionId: 'e1' })).toBe('/executions/e1');
    expect(notificationDeepLink({ eventType: 'execution_failed' })).toBe('/records');
  });

  it('deep-links unresolved outcomes to the reconciliation detail when available', () => {
    expect(notificationDeepLink({ eventType: 'side_effect_outcome_unknown', reconciliationCaseId: 'r1' })).toBe('/reconciliation/r1');
    expect(notificationDeepLink({ eventType: 'side_effect_outcome_unknown', executionId: 'e1', reconciliationCaseId: 'r1' })).toBe('/reconciliation/r1');
  });

  it('leaves plain reminders in place without forcing navigation', () => {
    expect(notificationDeepLink({ eventType: 'daily_summary_ready' })).toBeNull();
  });
});
