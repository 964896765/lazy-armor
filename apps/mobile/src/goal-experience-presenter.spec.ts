import { describe, expect, it } from 'vitest';
import { actionableWorkItems, presentGoalBrief, presentAuthoringJob, parseGoalExperience } from './goal-experience-presenter';
import type { WorkItemProjection } from '@lazy-armor/plan-schema/mobile';
const now = '2026-10-11T00:00:00.000Z';
const id = '01a12549-5915-7043-b5f3-ee6258827525';
describe('Goal experience Mobile boundary', () => {
  it('keeps user facts, assumptions and unanswered requirements separate without new consent buttons', () => {
    const view = presentGoalBrief({ schemaVersion: 'goal-brief.v1', goalId: 'goal', version: 1, statement: '开洗车店', domain: 'business', lifecycle: 'TEMPORARY', outcomeKind: 'REPORT', fields: [
      { key: 'goal', value: '开洗车店', status: 'USER_STATED', sourceRefs: [{ kind: 'USER_MESSAGE', id: 'u1', quote: '开洗车店' }] },
      { key: 'location', value: '荆门', status: 'USER_STATED', sourceRefs: [{ kind: 'USER_MESSAGE', id: 'u1', quote: '荆门' }] },
      { key: 'budget', value: '10 万元', status: 'ASSUMPTION', sourceRefs: [] },
      { key: 'successCriteria', value: null, status: 'UNKNOWN', sourceRefs: [] },
    ], readiness: { state: 'NEEDS_CLARIFICATION', reasonCodes: ['SUCCESS_CRITERIA_UNKNOWN'], questions: [{ key: 'successCriteria', question: '什么结果算成功？' }], executionAuthorized: false }, createdAt: now, executionAuthorized: false });
    expect(view?.known).toEqual(['地点：荆门']); expect(view?.assumptions).toEqual(['预算：10 万元']); expect(view?.unknown).toEqual(['成功标准']);
    expect(presentGoalBrief({ executionAuthorized: true })).toBeNull();
  });
  it('displays durable job failure and rejects authority-bearing data', () => {
    const job = { schemaVersion: 'authoring-job.v1', jobId: id, conversationId: id, requestId: 'r', status: 'FAILED', stage: 'STOPPED', attemptCount: 2, maxAttempts: 2, createdAt: now, updatedAt: now, deadlineAt: now, resultMessageId: null, errorCode: 'MODEL_UNAVAILABLE', executionAuthorized: false };
    expect(presentAuthoringJob(job)).toMatchObject({ label: '本次方案未生成', pending: false, failed: true });
    expect(presentAuthoringJob({ ...job, executionAuthorized: true })).toBeNull();
    expect(parseGoalExperience({ items: [] })).toBeNull();
  });
  it('only opens useful existing next-action routes and suppresses duplicate or unsafe routes', () => {
    const item: WorkItemProjection = { id: 'p', kind: 'Plan', title: '计划', status: 'ATTENTION', nextAction: 'CONNECT_RESOURCE', nextActionLabel: '补充资源', sourceRef: { type: 'Plan', id: 'p' }, evidenceRefs: [], updatedAt: now, primaryAction: { label: '查看', path: '/plans/p' } };
    expect(actionableWorkItems([item, item, { ...item, id: 'bad', sourceRef: { type: 'Plan', id: 'bad' }, primaryAction: { label: 'bad', path: '//external.test' } }, { ...item, id: 'done', nextAction: 'COMPLETE' }])).toEqual([item]);
  });
});
