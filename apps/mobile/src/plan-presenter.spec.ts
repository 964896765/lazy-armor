import { describe, expect, it } from 'vitest';
import { consumerPlanGroup, consumerPlanGroupSubtitle, consumerPlanStatusLabel, consumerPlanStatusTone, isFailedPlanStatus, isManagingPlanStatus, isValidScenarioKey, planDomainLabel, planEvidenceLine, planExceptionReason, planNextRunLabel, planStatusLabel, planStatusTone, planVisualIcon, templateGroupLabel } from './plan-presenter';

describe('Plan presenter', () => {
  it('maps known templates into the four consumer spaces', () => {
    expect(consumerPlanGroup({ templateKey: 'device-consumable-reminder' })).toBe('property');
    expect(consumerPlanGroup({ templateKey: 'monthly-bill-summary' })).toBe('property');
    expect(consumerPlanGroup({ templateKey: 'quiet-delivery-guard' })).toBe('life');
    // 旧“我的事情”模板在缺少 domain 时不得猜测新空间，归入“其他”。
    expect(consumerPlanGroup({ templateKey: 'daily-important-summary' })).toBe('其他');
  });

  it('does not guess a space from legacy plan-center kind without a domain', () => {
    expect(consumerPlanGroup({ planCenterKind: 'household' })).toBe('其他');
    expect(consumerPlanGroup({ planCenterKind: 'device' })).toBe('其他');
    expect(consumerPlanGroup({ planCenterKind: 'study' })).toBe('其他');
    expect(consumerPlanGroup({ planCenterKind: 'unknown' })).toBe('其他');
  });

  it('keeps group subtitles and labels in consumer language', () => {
    expect(templateGroupLabel('我的钱')).toBe('我的财物');
    expect(templateGroupLabel('我的东西')).toBe('我的财物');
    expect(consumerPlanGroupSubtitle('property')).toContain('财务');
    expect(consumerPlanGroupSubtitle('life')).toContain('日常');
  });

  it('uses the canonical domain catalog and splits legacy work into affairs/work', () => {
    expect(consumerPlanGroup({ domain: 'health' })).toBe('life');
    expect(consumerPlanGroup({ domain: 'identity_docs' })).toBe('affairs');
    expect(consumerPlanGroup({ domain: 'work' })).toBe('work');
    expect(consumerPlanGroup({ domain: 'vehicle' })).toBe('property');
    expect(consumerPlanGroup({ domain: 'billing' })).toBe('property');
    expect(planDomainLabel('legal_contract')).toBe('合同与法律事务');
    expect(planDomainLabel('general')).toBe('日常事务');
  });

  it('builds consumer-facing plan card content without internal statuses', () => {
    expect(planVisualIcon('每日重要事项摘要', 'daily_summary')).toBe('mail-outline');
    expect(planVisualIcon('车辆保养提醒')).toBe('car-outline');
    expect(planStatusLabel('degraded')).toBe('需要留意');
    expect(planStatusLabel('blocked')).toBe('暂时停下');
    expect(planStatusTone('active')).toBe('success');
    expect(planStatusTone('draft')).toBe('warning');
    expect(planStatusTone('paused')).toBe('muted');
    expect(planNextRunLabel('paused', null)).toBe('需要时可以重新开启');
    expect(planNextRunLabel('active', null)).toBe('下一次时间正在安排');
  });

  it('projects a consumer plan status without leaking internal codes', () => {
    expect(consumerPlanStatusLabel({ status: 'active' })).toBe('运行中');
    expect(consumerPlanStatusLabel({ status: 'active', hasMissingConnection: true })).toBe('等待连接');
    expect(consumerPlanStatusLabel({ status: 'active', hasMissingPermission: true })).toBe('等待授权');
    expect(consumerPlanStatusLabel({ status: 'active', hasMissingData: true })).toBe('等待数据');
    expect(consumerPlanStatusLabel({ status: 'active', needsConfirmation: true })).toBe('需要确认');
    expect(consumerPlanStatusLabel({ status: 'paused' })).toBe('暂停');
    expect(consumerPlanStatusLabel({ status: 'degraded' })).toBe('异常');
    expect(consumerPlanStatusTone({ status: 'active' })).toBe('success');
    expect(consumerPlanStatusTone({ status: 'active', hasMissingConnection: true })).toBe('warning');
    expect(consumerPlanStatusTone({ status: 'degraded' })).toBe('warning');
  });

  it('explains a plan exception in consumer language', () => {
    expect(planExceptionReason({ hasMissingConnection: true })).toContain('连接或授权');
    expect(planExceptionReason({ latestExecution: { status: 'failed', resultSummary: '服务暂时不可用' } })).toBe('服务暂时不可用');
    expect(planExceptionReason({ latestExecution: { status: 'failed', resultSummary: null } })).toContain('没有成功');
    expect(planExceptionReason({ planCenterSummary: { isException: true, latestEventSummary: '快递异常' } })).toBe('快递异常');
    expect(planExceptionReason({})).toBeNull();
    expect(planExceptionReason({ latestExecution: { status: 'succeeded', resultSummary: '正常' } })).toBeNull();
  });

  it('builds a consumer "查看依据" line for device consumable evidence', () => {
    const line = planEvidenceLine({
      factLabel: '滤芯预计剩余天数',
      value: '8 天',
      sourceLabel: '设备 App',
      observedAt: '今天 10:21',
      realityLabel: '已验证',
      ruleLabel: '剩余 ≤ 30 天时提醒',
    });
    expect(line).toContain('检测到：滤芯预计剩余天数 8 天');
    expect(line).toContain('来源：设备 App');
    expect(line).toContain('获取时间：今天 10:21');
    expect(line).toContain('状态：已验证');
    expect(line).toContain('计划规则：剩余 ≤ 30 天时提醒');
    expect(line).not.toContain('device.consumable.remaining_days');
    expect(line).not.toContain('PREDICTIVE_PREPARE');
  });

  it('classifies managed plan statuses without claiming execution', () => {
    for (const status of ['active', 'ready', 'degraded', 'blocked']) expect(isManagingPlanStatus(status)).toBe(true);
    for (const status of ['paused', 'archived', 'failed', 'error', 'draft']) expect(isManagingPlanStatus(status)).toBe(false);
  });

  it('keeps blocked out of the failed bucket so the real block reason stays visible', () => {
    expect(isFailedPlanStatus('blocked')).toBe(false);
    expect(isFailedPlanStatus('failed')).toBe(true);
    expect(isFailedPlanStatus('error')).toBe(true);
    expect(isFailedPlanStatus('active', 'failed')).toBe(true);
    expect(isFailedPlanStatus('active', null, 'FAILED')).toBe(true);
    expect(isFailedPlanStatus('active', 'succeeded', 'SUCCESS')).toBe(false);
  });

  it('validates the scenario create entry param', () => {
    expect(isValidScenarioKey('daily_life.delivery')).toBe(true);
    expect(isValidScenarioKey('finance.bill')).toBe(true);
    expect(isValidScenarioKey('')).toBe(false);
    expect(isValidScenarioKey('daily_life')).toBe(false);
    expect(isValidScenarioKey('daily_life.delivery.extra')).toBe(false);
    expect(isValidScenarioKey('../etc/passwd')).toBe(false);
    expect(isValidScenarioKey(null)).toBe(false);
    expect(isValidScenarioKey(undefined)).toBe(false);
  });
});
