import { describe, expect, it } from 'vitest';
import { deviceTaskOutcomeLabel, structuredReadOutcome, structuredReadOutcomeLabel, structuredReadStatusLabel } from './structured-read-presenter';

describe('structured read unified semantics', () => {
  it('never derives VERIFIED from candidateIds alone', () => {
    expect(structuredReadOutcome({ candidateIds: ['c1'], truthRecordIds: [] })).toBe('NEEDS_CONFIRMATION');
    expect(structuredReadOutcome({ candidateIds: [], truthRecordIds: [] })).toBe('BLOCKED');
    expect(structuredReadOutcome({ candidateIds: ['c1'], truthRecordIds: ['t1'] })).toBe('VERIFIED');
  });

  it('labels the three canonical outcomes without leaking internal codes', () => {
    expect(structuredReadOutcomeLabel('VERIFIED')).toBe('已核实');
    expect(structuredReadOutcomeLabel('NEEDS_CONFIRMATION')).toBe('需要确认');
    expect(structuredReadOutcomeLabel('BLOCKED')).toBe('已阻断');
    expect(structuredReadStatusLabel('AWAITING_ANDROID_STRUCTURED_READ_EVIDENCE')).toBe('等待设备证据');
    expect(structuredReadStatusLabel('UNKNOWN')).toBe('状态未知');
  });

  it('keeps DeviceTask SUCCEEDED distinct from candidate-only NEEDS_CONFIRMATION', () => {
    expect(deviceTaskOutcomeLabel({ status: 'SUCCEEDED' })).toBe('已完成并核实');
    expect(deviceTaskOutcomeLabel({ status: 'FAILED', errorCode: 'NEEDS_CONFIRMATION' })).toBe('已采集，等待确认');
    expect(deviceTaskOutcomeLabel({ status: 'FAILED', errorCode: 'RESULT_VERIFICATION_FAILED' })).toBe('结果未通过核实');
    expect(deviceTaskOutcomeLabel({ status: 'CLAIMED' })).toBe('处理中');
  });
});
