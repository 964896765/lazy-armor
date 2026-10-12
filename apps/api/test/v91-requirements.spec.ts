import { describe, expect, it } from 'vitest';
import { RequirementsService } from '../src/requirements/requirements.service';

const service = new RequirementsService();
const compile = (intent: string, extra: Record<string, unknown> = {}) => service.compile({ goalId: 'conversation', version: 1, messageId: 'user-message', intent, ...extra });
describe('V91 evidence-aware requirements', () => {
  it('asks a critical scope question for entrepreneurship without inventing a budget', () => {
    const brief = compile('我想创业');
    expect(brief.readiness).toMatchObject({ state: 'NEEDS_CLARIFICATION', reasonCodes: ['GOAL_SCOPE_UNSPECIFIED'], executionAuthorized: false });
    expect(brief.readiness.questions).toHaveLength(1);
    expect(brief.fields.find(field => field.key === 'budget')).toMatchObject({ status: 'UNKNOWN', value: null });
    expect(brief.lifecycle).toBeNull();
    expect(service.reportDelivery(brief)).toBeUndefined();
    expect(compile('我想创业，预算10万元').readiness.state).toBe('NEEDS_CLARIFICATION');
  });
  it('a specific Jingmen report proceeds while unresolved numbers remain unknown', () => {
    const brief = compile('在湖北荆门开洗车店的商业评估报告');
    expect(brief.readiness.state).toBe('READY_FOR_PROPOSAL');
    expect(brief.fields.find(field => field.key === 'location')).toMatchObject({ status: 'USER_STATED', value: '在湖北荆门' });
    expect(brief.fields.find(field => field.key === 'budget')?.status).toBe('UNKNOWN');
    expect(service.reportDelivery(brief)).toMatchObject({ kind: 'REPORT', acceptance: expect.arrayContaining(['SOURCE_PROVENANCE', 'ASSUMPTIONS_DISCLOSED']), executionAuthorized: false });
  });
  it('extracts the phone report wording without treating its trailing hypothetical budget as a personal fact', () => {
    const brief = compile('请生成湖北荆门城区开洗车店的商业评估报告。按租赁门店、2个工位、小型人工洗车加基础美容店评估，10万元预算只作本次测算假设。');
    expect(brief.fields.find(field => field.key === 'location')).toMatchObject({ status: 'USER_STATED', value: '湖北荆门城区', sourceRefs: [{ kind: 'USER_MESSAGE', id: 'user-message', quote: '湖北荆门城区' }] });
    expect(brief.fields.find(field => field.key === 'budget')).toMatchObject({ status: 'ASSUMPTION', value: '10万元预算', sourceRefs: [] });
    const corrected = compile('修正本次测算假设：总投入上限改为15万元，包含营运资金。荆门城区、租赁门店、2个工位和人工洗车加基础美容的范围保持。请重新自主生成报告。', { previous: brief, version: 2 });
    expect(corrected.fields.find(field => field.key === 'budget')).toMatchObject({ status: 'ASSUMPTION', value: '总投入上限改为15万元', sourceRefs: [] });
    expect(corrected.reportSubject?.kind).toBe('CAR_WASH_BUSINESS');
    expect(corrected.executionAuthorized).toBe(false);
    expect(compile('10万元预算，客流用测算假设，生成报告').fields.find(field => field.key === 'budget')).toMatchObject({ status: 'USER_STATED', value: '10万元预算' });
  });
  it('model values without exact excerpts stay assumptions even if a quote looks relevant', () => {
    const brief = compile('预算10万元，评估洗车店', { suggestions: [
      { key: 'budget', value: '100万元', quote: '预算10万元' },
      { key: 'successCriteria', value: '月利润5000元' },
    ] });
    expect(brief.fields.find(field => field.key === 'budget')).toMatchObject({ status: 'USER_STATED', value: '预算10万元' });
    expect(brief.fields.find(field => field.key === 'successCriteria')).toMatchObject({ status: 'ASSUMPTION', value: '月利润5000元', sourceRefs: [] });
  });
  it('carries original user provenance across clarifications and accepts explicit corrections', () => {
    const previous = compile('预算10万元，评估洗车店');
    const next = compile('预算8万元，地点在荆门，生成商业报告', { previous, version: 2, messageId: 'correction' });
    expect(next.fields.find(field => field.key === 'budget')).toMatchObject({ value: '预算8万元', sourceRefs: [{ id: 'correction' }] });
    expect(compile('预算改为8万元，重新生成报告', { previous, version: 2, messageId: 'correction' }).fields.find(field => field.key === 'budget')).toMatchObject({ value: '预算改为8万元', sourceRefs: [{ id: 'correction' }] });
    for (const intent of ['预算改15万，重新生成报告', '预算改到15万，重新生成报告'])
      expect(compile(intent, { previous, version: 2, messageId: 'correction' }).fields.find(field => field.key === 'budget')).toMatchObject({ value: intent.split('，')[0], sourceRefs: [{ id: 'correction' }] });
    expect(() => compile('生成报告', { previous, version: 1, goalId: 'other-conversation' })).toThrow('GOAL_BRIEF_SOURCE_CHANGED');
  });
  it('reviewed historical sources never override direct statements or invent missing values', () => {
    const brief = compile('评估洗车店报告', { confirmedSources: [{ key: 'budget', value: '8万元', content: '预算8万元', sourceRef: { kind: 'CONFIRMED_MEMORY', id: 'memory', version: 2, quote: '预算8万元' } }] });
    expect(brief.fields.find(field => field.key === 'budget')).toMatchObject({ status: 'CONFIRMED', value: '8万元' });
    expect(() => compile('评估洗车店', { confirmedSources: [{ key: 'budget', value: '80万元', content: '预算8万元', sourceRef: { kind: 'CONFIRMED_MEMORY', id: 'memory', version: 2, quote: '预算8万元' } }] })).toThrow('NOT_GROUNDED');
  });
  it('explicit hypothetical or withdrawn budgets are never carried as personal facts', () => {
    expect(compile('假设预算10万元，评估洗车店报告').fields.find(field => field.key === 'budget')).toMatchObject({ status: 'ASSUMPTION', value: '预算10万元', sourceRefs: [] });
    expect(compile('假设预算10万元，评估洗车店报告', { suggestions: [{ key: 'budget', value: '10万元', quote: '预算10万元' }] }).fields.find(field => field.key === 'budget')?.status).toBe('ASSUMPTION');
    const previous = compile('预算10万元，评估洗车店报告');
    expect(compile('预算还没确定，继续评估洗车店报告', { previous, version: 2 }).fields.find(field => field.key === 'budget')).toMatchObject({ status: 'UNKNOWN', value: null, sourceRefs: [] });
  });
  it('only typed condition updates inherit the original car-wash scope and explicit new targets clear old scoped facts', () => {
    const previous = compile('在湖北荆门开洗车店的商业评估报告，预算10万元，月收入5000元');
    const continued = compile('预算改15万，重新生成报告', { previous, version: 2, messageId: 'correction' });
    expect(continued.reportSubject).toMatchObject({ kind: 'CAR_WASH_BUSINESS', sourceRefs: [{ id: 'user-message' }] });
    expect(continued.fields.find(field => field.key === 'budget')?.value).toBe('预算改15万');
    const switched = compile('改为成都旅行计划报告', { previous, version: 2, messageId: 'new-target' });
    expect(switched.reportSubject).toMatchObject({ kind: 'GENERAL', sourceRefs: [{ id: 'new-target' }] });
    for (const key of ['budget', 'location', 'successCriteria']) expect(switched.fields.find(field => field.key === key)).toMatchObject({ value: null, status: 'UNKNOWN', sourceRefs: [] });
  });
  it('the full confirmation hash changes when a requirement or lifecycle changes', () => {
    const original = compile('评估洗车店报告');
    const changed = structuredClone(original);
    changed.fields.find(field => field.key === 'budget')!.status = 'ASSUMPTION';
    changed.fields.find(field => field.key === 'budget')!.value = '预算10万元';
    expect(service.reference(changed).contentHash).not.toBe(service.reference(original).contentHash);
    expect(service.reference({ ...original, lifecycle: 'PERSISTENT' }).contentHash).not.toBe(service.reference(original).contentHash);
  });
  it('long existing messages remain intact and no confidence threshold creates execution authority', () => {
    const intent = '评'.repeat(12000), brief = compile(intent);
    expect(brief.statement).toBe(intent);
    expect(brief.fields[0].sourceRefs[0].quote).toBe(intent);
    expect(brief.executionAuthorized).toBe(false);
    expect(brief.readiness.executionAuthorized).toBe(false);
  });
});
