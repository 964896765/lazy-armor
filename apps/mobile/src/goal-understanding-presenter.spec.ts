import { describe, expect, it } from 'vitest';
import type { GoalUnderstanding } from '@lazy-armor/plan-schema/mobile';
import { presentGoalUnderstanding } from './goal-understanding-presenter';

const proposed: GoalUnderstanding = {
  schemaVersion: 'goal-understanding.v1', proposalId: 'proposal', stage: 'AI_PROPOSED', summary: '去医院', domain: null,
  lifecycle: 'USER_EVENT', executionMode: 'DIRECT', requiredFacts: [], capabilities: [], steps: ['CONFIRM', 'SAVE_EVENT', 'WAIT'],
  missingRequirements: [], selectedSkillIds: [], truthRefs: [],
  policy: { confirmationRequired: true, approval: 'NOT_APPLICABLE', executionAuthorized: false },
  provenance: { modelId: 'test-model', generatedAt: '2026-10-09T00:00:00Z' },
};
describe('goal understanding consumer contract', () => {
  it('requires scope confirmation for a temporary page read without calling it a saved personal item', () => {
    const view = presentGoalUnderstanding({ ...proposed, lifecycle: 'TEMPORARY', summary: '读取计算器当前结果', capabilities: [{ key: 'structured_read.field', availability: 'UNRESOLVED', reasons: ['SESSION_CONSENT_REQUIRED'], sourcePackage: 'com.miui.calculator' }], steps: ['CONFIRM', 'ACQUIRE', 'ASSESS'] }, 'ANSWER');
    expect(view?.policy).toContain('字段范围');
    expect(view?.policy).not.toContain('内部事项');
    expect(view?.steps[0]).toBe('确认方案');
  });
  it('presents a personal item without external capabilities, completion or fabricated estimates', () => {
    const view = presentGoalUnderstanding(proposed, 'USER_EVENT_DRAFT');
    expect(view?.lifecycle).toBe('个人事项');
    expect(view?.capabilities).toEqual([]);
    expect(view?.policy).toBe('确认后保存为内部事项。');
    expect(JSON.stringify(view)).not.toMatch(/已完成|5分钟|已授权/);
  });
  it.each([{ schemaVersion: 'future' }, { policy: { ...proposed.policy, executionAuthorized: true } }, { stage: 'EXECUTING' }, { executionId: 'client-injected' }])('hides incompatible or authority-bearing payloads %j', patch => {
    expect(presentGoalUnderstanding({ ...proposed, ...patch }, 'USER_EVENT_DRAFT')).toBeNull();
  });
  it('rejects lifecycle mismatch and unavailable legacy data without guessing', () => {
    expect(presentGoalUnderstanding(proposed, 'PLAN_DRAFT')).toBeNull();
    expect(presentGoalUnderstanding(undefined, 'USER_EVENT_DRAFT')).toBeNull();
    expect(presentGoalUnderstanding(proposed, 'MODEL_UNAVAILABLE')).toBeNull();
  });
  it('explains an unresolved external write with independent policy and no fake success', () => {
    const view = presentGoalUnderstanding({ ...proposed, capabilities: [{ key: 'calendar.event.create', availability: 'UNRESOLVED', reasons: [] }], policy: { ...proposed.policy, approval: 'RUNTIME_POLICY' } }, 'USER_EVENT_DRAFT');
    expect(view?.capabilities).toEqual([{ name: '创建外部日历事项', state: '需要检查资源', reasons: [] }]);
    expect(view?.policy).toContain('独立审批');
  });
});
