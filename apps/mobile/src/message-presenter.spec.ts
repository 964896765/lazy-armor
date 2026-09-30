import { describe, expect, it } from 'vitest';
import { formatUnreadCount, messageChannel, messageChannelLabel } from './message-presenter';

describe('message presenter 分类', () => {
  it('classifies connection/credential/device events as system notifications', () => {
    expect(messageChannel('permission_revoked')).toBe('system');
    expect(messageChannel('connection_reconnect_required')).toBe('system');
    expect(messageChannel('credential_revoked')).toBe('system');
    expect(messageChannel('missing_connection')).toBe('system');
    expect(messageChannel('device_offline')).toBe('system');
  });

  it('classifies plan/execution/approval events as plan activity', () => {
    expect(messageChannel('execution_succeeded')).toBe('plan');
    expect(messageChannel('execution_failed')).toBe('plan');
    expect(messageChannel('approval_required')).toBe('plan');
    expect(messageChannel('side_effect_outcome_unknown')).toBe('plan');
    expect(messageChannel('daily_important_summary')).toBe('plan');
  });

  it('falls back to plan activity for unknown event types and null', () => {
    expect(messageChannel('unknown_event')).toBe('plan');
    expect(messageChannel(null)).toBe('plan');
    expect(messageChannel(undefined)).toBe('plan');
  });

  it('labels channels in Chinese', () => {
    expect(messageChannelLabel('system')).toBe('系统通知');
    expect(messageChannelLabel('plan')).toBe('计划动态');
  });
});

describe('message presenter 未读数', () => {
  it('formats unread counts including the 99+ cap', () => {
    expect(formatUnreadCount(0)).toBe('0');
    expect(formatUnreadCount(3)).toBe('3');
    expect(formatUnreadCount(99)).toBe('99');
    expect(formatUnreadCount(100)).toBe('99+');
    expect(formatUnreadCount(120)).toBe('99+');
  });
});
