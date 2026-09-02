import { describe, expect, it } from 'vitest';
import {
  capabilityDescription,
  capabilityLabel,
  connectionStatusExplanation,
  connectionStatusNextStep,
  connectionRecoveryAction,
  connectionStatusLabel,
  consumerErrorMessage,
  consumerErrorNextStep,
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

  it('explains connection status and next step in plain language', () => {
    expect(connectionStatusExplanation('reauthorization_required')).toContain('重新连接');
    expect(connectionStatusExplanation('permission_required')).toContain('授权范围');
    expect(connectionStatusNextStep('expired')).toContain('重新连接');
    expect(connectionStatusNextStep('provider_error')).toContain('稍后重新检查');
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
    ['gmail', 'CREATE_DRAFT'], ['google_calendar', 'READ_EVENT'], ['google_calendar', 'CREATE_EVENT'], ['google_calendar', 'UPDATE_EVENT'], ['file_provider', 'READ_FILE_METADATA'],
    ['file_provider', 'READ_FILE'], ['logistics_provider', 'READ_TRACKING'], ['content_provider', 'READ_CONTENT'],
    ['content_provider', 'CREATE_DRAFT'], ['content_provider', 'PUBLISH_CONTENT'], ['content_provider', 'READ_ANALYTICS'],
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

  it('maps technical failures into consumer-safe language', () => {
    expect(consumerErrorMessage('OAuth token refresh failed')).toContain('重新连接');
    expect(consumerErrorMessage('OUTCOME_UNKNOWN')).toContain('无法自动确认');
    expect(consumerErrorMessage('provider timeout')).toContain('响应超时');
    expect(consumerErrorMessage('TypeError: ConnectorError SQLSTATE[42S22] requestId=abc123')).toBe('这次处理暂时没有完成，可以稍后再试。');
    expect(consumerErrorNextStep('rate limited')).toContain('等一会儿');
    expect(consumerErrorNextStep('TypeError: ConnectorError SQLSTATE[42S22] requestId=abc123')).toBe('如果连续失败，请检查连接和权限。');
    expect(consumerErrorNextStep('permission revoked')).toContain('重新授权');
  });

  it.each([
    ['calendar permission revoked', '相关授权已经被撤销，计划暂时不能继续读取或执行。', '去“我的连接”重新授权后，这条计划会继续工作。'],
    ['calendar connection expired', '连接已经过期，重新连接后这条计划才能继续运行。', '去“我的连接”重新连接后，再回来重试。'],
    ['calendar credentials revoked', '账号登录状态已经失效，需要重新连接后才能继续运行。', '重新连接对应账号后，再回来启用或重试。'],
    ['provider timeout', '服务响应超时，这次暂时没有拿到结果。', '稍后重新检查；如果连续失败，再重新连接一次。'],
    ['provider unavailable', '服务暂时不可用，稍后可以再试一次。', '稍后重新检查；如果连续失败，再重新连接一次。'],
    ['rate limited', '服务方临时限制了访问频率，稍后再试即可。', '先等一会儿再试，不需要重复点很多次。'],
    ['missing connection', '这条计划缺少可用连接，补上后就能继续运行。', '重新连接对应账号后，再回来启用或重试。'],
    ['configuration incomplete', '这条计划还没配置完整，补齐后就能继续运行。', '回到计划详情补齐设置，再重新启用。'],
    ['plan failed', '这次计划没有按预期完成。', '如果连续失败，请检查连接和权限。'],
    ['OUTCOME_UNKNOWN', '这次结果暂时无法自动确认，需要你看一下是否已经处理成功。', '打开记录确认实际结果；如未成功，再重新执行一次。'],
    ['network failure', '网络暂时不可用，这次没能完成同步。', '先确认网络恢复，再重新加载或手动执行。'],
    ['unknown internal error', '这次处理暂时没有完成，可以稍后再试。', '如果连续失败，请检查连接和权限。'],
  ])('covers failure matrix copy for %s', (detail, message, nextStep) => {
    expect(consumerErrorMessage(detail)).toBe(message);
    expect(consumerErrorNextStep(detail)).toBe(nextStep);
  });
});
