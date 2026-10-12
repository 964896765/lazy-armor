import { describe, expect, it } from 'vitest';
import { resolveReportMethodInputs, reportMethodOutputSchema, type ReportSource } from '@lazy-armor/plan-schema';
import { methodFixture } from './fixtures/report-method-fixture';
import { assertReportMethodPrefix, checkedReportMethodRun } from '../src/agent/reports/report-method-state';


describe('report method fields and persisted prefix', () => {
  it('feeds real integer zero and false into the next method without inventing or coercing inputs', () => {
    const composition = methodFixture();
    const first = checkedReportMethodRun(composition, composition.methods[0], [], [], { outputs: { count: 0, ready: false }, sourceIds: [] }, 'fixture');
    expect(resolveReportMethodInputs(composition, composition.methods[1], [first])).toEqual({ count: 0, ready: false });
    const second = checkedReportMethodRun(composition, composition.methods[1], [first], [], { outputs: { report: '基于前序真实字段的报告' }, sourceIds: [] }, 'fixture');
    expect(() => assertReportMethodPrefix(composition, [first, second], [], true)).not.toThrow();
    expect(first).toMatchObject({ provenance: 'MODEL_GENERATED_UNVERIFIED', verification: 'CONTRACT_CHECKED_ONLY', semanticVerified: false });
  });
  it('rejects fabricated predecessors, missing fields, wrong scalar types and extra fields', () => {
    const composition = methodFixture(), first = composition.methods[0];
    expect(() => resolveReportMethodInputs(composition, composition.methods[1], [])).toThrow('REPORT_METHOD_UPSTREAM_REQUIRED');
    for (const outputs of [{ count: 0 }, { count: '0', ready: false }, { count: 0.5, ready: false }, { count: 0, ready: false, tool: 'execute' }])
      expect(() => checkedReportMethodRun(composition, first, [], [], { outputs, sourceIds: [] }, 'fixture')).toThrow('REPORT_METHOD_OUTPUT_INVALID');
  });
  it('rejects altered output, input, method content, reordered records and incomplete final delivery on recovery', () => {
    const composition = methodFixture(), first = checkedReportMethodRun(composition, composition.methods[0], [], [], { outputs: { count: 1, ready: true }, sourceIds: [] }, 'fixture');
    for (const changed of [{ ...first, outputs: { count: 2, ready: true } }, { ...first, inputs: { goal: '另一个目标' } }, { ...first, methodRef: composition.methods[1].ref }])
      expect(() => assertReportMethodPrefix(composition, [changed], [])).toThrow('REPORT_METHOD_STATE_INVALID');
    expect(() => assertReportMethodPrefix(composition, [first], [], true)).toThrow('REPORT_METHOD_STATE_INVALID');
    const changed = structuredClone(composition); changed.methods[0].manifest.instruction = '改变方法说明';
    expect(() => assertReportMethodPrefix(changed, [], [])).toThrow('REPORT_METHOD_STATE_INVALID');
  });
  it('requires declared supplied citations and rejects missing selected output even if the port was optional', () => {
    const composition = methodFixture();
    const source: ReportSource = { id: 'S1', label: '隔离资料', provenance: 'USER_UPLOADED_UNVERIFIED', content: '隔离原文', sha256: 'a'.repeat(64), observedAt: '2026-10-12T00:00:00.000Z' };
    const schema = reportMethodOutputSchema(composition, composition.methods[1], [source]);
    expect(schema.safeParse({ outputs: { report: '[S1]分析' }, sourceIds: ['S1'] }).success).toBe(true);
    expect(schema.safeParse({ outputs: { report: '[S1]分析' }, sourceIds: [] }).success).toBe(false);
    expect(schema.safeParse({ outputs: { report: '[S2]分析' }, sourceIds: ['S2'] }).success).toBe(false);
    expect(schema.safeParse({ outputs: { report: '' }, sourceIds: [] }).success).toBe(false);
    expect(schema.safeParse({ outputs: { report: '[原文](https://invented.example/report)' }, sourceIds: ['S1'] }).success).toBe(false);
  });
});
