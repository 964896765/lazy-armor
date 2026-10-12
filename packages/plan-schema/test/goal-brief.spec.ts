import { describe, expect, it } from 'vitest';
import { goalBriefSchema, goalBriefFieldSchema } from '../src/goal-brief';
import { deliverySpecSchema } from '../src/delivery-spec';

const field = { key: 'budget', value: '10万元', status: 'USER_STATED', sourceRefs: [{ kind: 'USER_MESSAGE', id: 'user-message', quote: '预算10万元' }] };
const brief = { schemaVersion: 'goal-brief.v1', goalId: 'goal', version: 1, statement: '评估洗车店', domain: null, lifecycle: null,
  outcomeKind: 'REPORT', fields: [{ ...field, key: 'goal', value: '评估洗车店', sourceRefs: [{ kind: 'USER_MESSAGE', id: 'user-message', quote: '评估洗车店' }] }],
  readiness: { state: 'READY_FOR_PROPOSAL', reasonCodes: [], questions: [], executionAuthorized: false }, createdAt: '2026-10-11T00:00:00.000Z', executionAuthorized: false };

describe('GoalBrief provenance and authority boundary', () => {
  it('rejects a user budget different from its actual source excerpt', () => {
    expect(goalBriefFieldSchema.safeParse(field).success).toBe(true);
    expect(goalBriefFieldSchema.safeParse({ ...field, value: '100万元' }).success).toBe(false);
    expect(goalBriefFieldSchema.safeParse({ ...field, sourceRefs: [] }).success).toBe(false);
  });
  it('keeps assumptions and unknowns separate from confirmed facts', () => {
    expect(goalBriefFieldSchema.safeParse({ ...field, status: 'ASSUMPTION', sourceRefs: [] }).success).toBe(true);
    expect(goalBriefFieldSchema.safeParse({ ...field, status: 'ASSUMPTION' }).success).toBe(false);
    expect(goalBriefFieldSchema.safeParse({ key: 'budget', status: 'UNKNOWN', value: null, sourceRefs: [] }).success).toBe(true);
    expect(goalBriefFieldSchema.safeParse({ ...field, status: 'UNKNOWN', sourceRefs: [] }).success).toBe(false);
  });
  it('requires immutable versions on reviewed memory and truth sources', () => {
    const reviewed = { ...field, status: 'CONFIRMED', sourceRefs: [{ kind: 'CONFIRMED_MEMORY', id: 'memory', quote: '预算10万元' }] };
    expect(goalBriefFieldSchema.safeParse(reviewed).success).toBe(false);
    expect(goalBriefFieldSchema.safeParse({ ...reviewed, sourceRefs: [{ ...reviewed.sourceRefs[0], version: 2 }] }).success).toBe(true);
  });
  it('rejects fabricated authority and conflicting field identities', () => {
    expect(goalBriefSchema.safeParse(brief).success).toBe(true);
    expect(goalBriefSchema.safeParse({ ...brief, executionAuthorized: true }).success).toBe(false);
    expect(goalBriefSchema.safeParse({ ...brief, approvalGranted: true }).success).toBe(false);
    expect(goalBriefSchema.safeParse({ ...brief, fields: [...brief.fields, ...brief.fields] }).success).toBe(false);
    expect(goalBriefSchema.safeParse({ ...brief, readiness: { ...brief.readiness, state: 'NEEDS_CLARIFICATION' } }).success).toBe(false);
  });
  it('a car-wash delivery type cannot claim an unrelated or memory-only project source', () => {
    expect(goalBriefSchema.safeParse({ ...brief, reportSubject: { kind: 'CAR_WASH_BUSINESS', sourceRefs: [{ kind: 'USER_MESSAGE', id: 'message', quote: '成都旅行报告' }] } }).success).toBe(false);
    expect(goalBriefSchema.safeParse({ ...brief, reportSubject: { kind: 'CAR_WASH_BUSINESS', sourceRefs: [{ kind: 'CONFIRMED_MEMORY', id: 'memory', version: 1, quote: '洗车店商业报告' }] } }).success).toBe(false);
  });
  it('preserves the full 12000-character user message boundary', () => {
    const content = '评'.repeat(12000);
    expect(goalBriefSchema.safeParse({ ...brief, statement: content, fields: [{ key: 'goal', value: content, status: 'USER_STATED', sourceRefs: [{ kind: 'USER_MESSAGE', id: 'message', quote: content }] }] }).success).toBe(true);
  });
  it('report delivery promises cannot install executable verification code', () => {
    const delivery = { schemaVersion: 'delivery-spec.v1', kind: 'REPORT', goalBriefRef: { goalId: 'goal', version: 1, contentHash: 'a'.repeat(64) }, title: '洗车店评估', sections: ['财务测算'], acceptance: ['ASSUMPTIONS_DISCLOSED'], limitations: [], executionAuthorized: false };
    expect(deliverySpecSchema.safeParse(delivery).success).toBe(true);
    expect(deliverySpecSchema.safeParse({ ...delivery, acceptance: ['eval(code)'] }).success).toBe(false);
    expect(deliverySpecSchema.safeParse({ ...delivery, executeNow: true }).success).toBe(false);
  });
});
