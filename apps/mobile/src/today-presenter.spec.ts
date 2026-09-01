import { describe, expect, it } from 'vitest';
import { approvalRiskText, approvalStatusLabel, notificationPriorityLabel, riskLevelLabel, stepApprovalLabel, todayState } from './today-presenter';

describe('Today presenter', () => {
  it('represents auth, loading, error, empty and ready states', () => {
    expect(todayState(false, false, false, 0)).toBe('signed_out');
    expect(todayState(true, true, false, 0)).toBe('loading');
    expect(todayState(true, false, true, 0)).toBe('error');
    expect(todayState(true, false, false, 0)).toBe('empty');
    expect(todayState(true, false, false, 1)).toBe('ready');
  });
  it('uses natural priority and approval language', () => {
    expect(notificationPriorityLabel('P0')).toBe('紧急');
    expect(notificationPriorityLabel('P1')).toBe('重要');
    expect(notificationPriorityLabel('P2')).toBe('摘要');
    expect(notificationPriorityLabel('P3')).toBe('静默');
    expect(approvalRiskText('R3')).toContain('外部');
    expect(approvalRiskText('R4')).toContain('资金或账户级');
    expect(approvalRiskText('R2')).toContain('准备');
    expect(approvalRiskText('R0')).toContain('仅读取');
  });
  it('labels approval status and risk levels without leaking internal codes', () => {
    expect(approvalStatusLabel('pending')).toBe('待确认');
    expect(approvalStatusLabel('approved')).toBe('已确认');
    expect(approvalStatusLabel('rejected')).toBe('已拒绝');
    expect(approvalStatusLabel('expired')).toBe('已过期');
    expect(approvalStatusLabel('cancelled')).toBe('已取消');
    expect(riskLevelLabel('R4')).toBe('资金账户级');
    expect(riskLevelLabel(null)).toBe('未评估');
  });
  it('renders step approval state in plain language', () => {
    expect(stepApprovalLabel({ approvalGateStatus: 'waiting_approval' })).toBe('等待你的确认');
    expect(stepApprovalLabel({ approvalGateStatus: 'approved' })).toBe('已确认通过');
    expect(stepApprovalLabel({ approvalGateStatus: 'authorized' })).toBe('临时授权命中，已放行');
    expect(stepApprovalLabel({ approvalGateStatus: 'not_required' })).toBe('无需确认');
    expect(stepApprovalLabel({ approvalGateStatus: 'rejected' })).toBe('已拒绝');
    expect(stepApprovalLabel({})).toBe('');
  });
});
