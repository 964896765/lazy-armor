import { describe, expect, it } from 'vitest';
import {
  capabilityDescription,
  capabilityLabel,
  connectionRecoveryAction,
  connectionStatusLabel,
  isConsumerConnector,
  providerReadinessLabel,
} from './connection-presenter';

describe('P2 mobile connection presenter', () => {
  it.each([
    ['pending_authorization', '正在连接'], ['connected', '已连接'], ['degraded', '连接异常'],
    ['expired', '需要重新连接'], ['permission_required', '需要补充权限'],
    ['reauthorization_required', '需要重新登录'], ['provider_error', '服务暂时异常'],
    ['revoked', '已断开'], ['future_status', '暂时无法确认状态'],
  ])('maps connection status %s', (status, label) => expect(connectionStatusLabel(status)).toBe(label));

  it('provides a precise recovery action', () => {
    expect(connectionRecoveryAction('reauthorization_required')).toBe('重新连接');
    expect(connectionRecoveryAction('expired')).toBe('重新连接');
    expect(connectionRecoveryAction('permission_required')).toBe('检查权限');
    expect(connectionRecoveryAction('provider_error')).toBe('重新检查');
    expect(connectionRecoveryAction('degraded')).toBe('连接有点问题');
    expect(connectionRecoveryAction('connected')).toBeNull();
  });

  it('uses provider context for shared capability keys', () => {
    expect(capabilityLabel('gmail', 'CREATE_DRAFT')).toBe('准备邮件草稿');
    expect(capabilityLabel('content_provider', 'CREATE_DRAFT')).toBe('准备内容草稿');
    expect(capabilityDescription('gmail', 'CREATE_DRAFT')).toContain('不会直接发送');
    expect(capabilityDescription('content_provider', 'CREATE_DRAFT')).toContain('不会直接发布');
  });

  it('keeps READ_TRACKING aligned and safely handles unknown values', () => {
    expect(capabilityLabel('logistics_provider', 'READ_TRACKING')).toBe('读取物流状态');
    expect(capabilityLabel('future_provider', 'UNKNOWN', '提供商权限')).toBe('提供商权限');
    expect(capabilityLabel('future_provider', 'UNKNOWN')).toBe('其他权限');
  });

  it.each([
    ['manual', 'MANUAL_INPUT'], ['internal', 'READ_INTERNAL'], ['internal', 'WRITE_INTERNAL'],
    ['webhook', 'RECEIVE_WEBHOOK'], ['gmail', 'READ_EMAIL_METADATA'], ['gmail', 'READ_EMAIL'],
    ['gmail', 'CREATE_DRAFT'], ['google_calendar', 'READ_EVENT'], ['file_provider', 'READ_FILE_METADATA'],
    ['file_provider', 'READ_FILE'], ['logistics_provider', 'READ_TRACKING'], ['content_provider', 'READ_CONTENT'],
    ['content_provider', 'CREATE_DRAFT'], ['content_provider', 'PUBLISH_CONTENT'],
  ])('presents current provider capability %s/%s in consumer language', (provider, capability) => {
    const label = capabilityLabel(provider, capability);
    expect(label).not.toBe('其他权限');
    expect(label).not.toBe(capability);
  });

  it('maps readiness and hides platform-only connectors', () => {
    expect(providerReadinessLabel('PRODUCTION_READY')).toBe('可使用');
    expect(providerReadinessLabel('BETA')).toBe('可试用');
    expect(providerReadinessLabel('DRAFT_ONLY')).toBe('开发中');
    expect(providerReadinessLabel('DISABLED')).toBe('暂不可用');
    expect(isConsumerConnector('gmail')).toBe(true);
    expect(isConsumerConnector('manual')).toBe(false);
    expect(isConsumerConnector('internal')).toBe(false);
  });
});
