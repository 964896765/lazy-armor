import { describe, expect, it } from 'vitest';
import {
  aiCapabilityCopy,
  clarificationQuestion,
  consumerDataDomain,
  deleteImpactText,
  devicePermissionCopy,
  disconnectImpactText,
  disconnectSteps,
  presentAgentPlanProposal,
  presentTruthDataRow,
  privacyCenterSections,
  truthDeletionBoundaryCopy,
  truthDeletionBoundaryLabel,
  visionPrivacyCopy,
} from './privacy-presenter';

describe('Privacy presenter', () => {
  it('defines the six privacy center sections without exposing internal systems', () => {
    const sections = privacyCenterSections();
    expect(sections.map((section) => section.title)).toEqual(['我的数据', '连接与授权', '设备权限', '数据保留', 'AI 与模型', '安全记录']);
    const joined = sections.map((section) => `${section.title} ${section.description}`).join(' ');
    expect(joined).not.toContain('Truth Store');
    expect(joined).not.toContain('MCP');
    expect(joined).not.toContain('Agent Planner');
    expect(joined).not.toContain('Capability Resolver');
  });

  it('maps truth resources to consumer domains, never database tables', () => {
    expect(consumerDataDomain('Bill')).toBe('财务');
    expect(consumerDataDomain('Shipment')).toBe('快递');
    expect(consumerDataDomain('Consumable')).toBe('设备');
    expect(consumerDataDomain('CalendarEvent')).toBe('工作');
    expect(consumerDataDomain('LearningRecord')).toBe('学习');
    expect(consumerDataDomain('Vehicle')).toBe('车辆');
    expect(consumerDataDomain('Household')).toBe('家庭');
    expect(consumerDataDomain('Unknown')).toBe('其他');
  });

  it('presents a truth row with value, source, observation time and plan usage', () => {
    const row = presentTruthDataRow({
      id: 't1',
      factKey: 'device.consumable.remaining_days',
      resourceType: 'Consumable',
      valueSummary: '8 天',
      sourceLabel: '设备 App',
      observedAt: '2026-09-19T02:21:00.000Z',
      realityLevel: 'VERIFIED',
      usedByPlanNames: ['设备耗材提醒'],
    });
    expect(row.domain).toBe('设备');
    expect(row.factLabel).toBe('滤芯预计剩余天数');
    expect(row.realityLabel).toBe('已验证');
    expect(row.usedByPlans).toBe('设备耗材提醒');
  });

  it('distinguishes deletion boundaries and always retains audit records', () => {
    expect(truthDeletionBoundaryLabel('STOP_COLLECTING')).toBe('停止采集');
    expect(truthDeletionBoundaryCopy('RETAIN_AUDIT_RECORD')).toContain('审计');
    expect(truthDeletionBoundaryCopy('DISCONNECT_SOURCE')).toContain('保留');
  });

  it('explains the impact of deleting data on dependent plans', () => {
    const copy = deleteImpactText(['设备耗材提醒'], '设备');
    expect(copy).toContain('设备');
    expect(copy).toContain('设备耗材提醒');
    expect(copy).toContain('审计');
  });

  it('explains disconnect impact and full downgrade chain', () => {
    expect(disconnectImpactText(['快递管家', '家庭补给'])).toBe('将影响 2 个计划：快递管家、家庭补给。');
    expect(disconnectImpactText([])).toContain('没有计划');
    const steps = disconnectSteps();
    expect(steps[0]).toBe('断开连接');
    expect(steps).toContain('能力就绪度更新');
    expect(steps).toContain('今天提醒你');
  });

  it('describes device permissions in consumer language', () => {
    const permissions = devicePermissionCopy();
    const screen = permissions.find((item) => item.key === 'screen_read')!;
    expect(screen.description).toContain('仅在你启动的读取会话中');
    expect(screen.description).not.toContain('Accessibility unrestricted');
    const joined = permissions.map((item) => item.description).join(' ');
    expect(joined).not.toContain('Accessibility unrestricted');
  });

  it('describes vision privacy as structured-read-first with no fake settings', () => {
    expect(visionPrivacyCopy()).toContain('默认关闭自动截图兜底');
    expect(visionPrivacyCopy()).toContain('结构化读取失败时');
  });

  it('states what AI can and cannot do', () => {
    const copy = aiCapabilityCopy();
    expect(copy.allowed).toContain('生成计划草稿');
    expect(copy.forbidden).toContain('支付');
    expect(copy.forbidden).toContain('批准操作');
    expect(copy.forbidden).toContain('删除重要数据');
    expect(copy.forbidden).toContain('绕过授权执行动作');
  });

  it('presents an agent plan draft as a proposal, not an executed action', () => {
    const presentation = presentAgentPlanProposal({
      intentSummary: '设备耗材提醒',
      requiredFacts: ['device.consumable.remaining_days'],
      requiredCapabilities: ['READ_INTERNAL'],
      toolRequirements: [{ toolName: '提醒我', requiresApproval: true }],
    });
    expect(presentation.title).toBe('我为你准备了一个计划');
    expect(presentation.needsConfirmation).toBe(true);
    expect(presentation.dataUsed).toContain('滤芯预计剩余天数');
    expect(presentation.title).not.toContain('已自动执行');
  });

  it('asks a direct clarification question instead of guessing', () => {
    expect(clarificationQuestion(['intent_too_vague'])).toContain('具体');
    expect(clarificationQuestion(['days_threshold'])).toBe('你希望低于多少天提醒？');
    expect(clarificationQuestion([])).toContain('补充');
  });
});
