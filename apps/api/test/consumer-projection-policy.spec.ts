import { describe, expect, it } from 'vitest';
import { consumerPlanStatus, dateWindow, requestTransitionAllowed, safeServiceUrl, temporaryConversationOutcome } from '../src/consumer/projection-policy';

describe('consumer projection policies', () => {
 it('distinguishes generated analysis from actions or failed model responses', () => {
  expect(temporaryConversationOutcome('ANSWER')).toEqual({ status: '已生成答复', statusGroup: 'COMPLETED' });
  for (const result of ['PLAN_DRAFT', 'MODEL_UNAVAILABLE', 'PLANNER_OUTPUT_INVALID', 'CLARIFICATION_REQUIRED', undefined]) expect(temporaryConversationOutcome(result).statusGroup).toBe('INCOMPLETE');
 });
 it('uses local day boundaries rather than UTC dates', () => {
  const day = dateWindow('2026-10-03', 'Asia/Shanghai');
  expect(day.start.toISOString()).toBe('2026-10-02T16:00:00.000Z');
  expect(day.end.toISOString()).toBe('2026-10-03T16:00:00.000Z');
 });
 it('supports daylight saving days with 23 or 25 hours', () => {
  const spring = dateWindow('2026-03-08', 'America/New_York');
  const autumn = dateWindow('2026-11-01', 'America/New_York');
  expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3600000);
  expect(autumn.end.getTime() - autumn.start.getTime()).toBe(25 * 3600000);
 });
 it('rejects impossible dates and unknown timezones', () => {
  expect(() => dateWindow('2026-02-30', 'Asia/Shanghai')).toThrow();
  expect(() => dateWindow('2026-10-03', 'Unknown/Zone')).toThrow();
 });
 it('requires a concrete public service URL', () => {
  for (const url of ['https://www.jd.com', 'javascript:alert(1)', 'http://localhost/service/1', 'https://user:pass@example.com/service/1', 'http://192.168.1.1/service/1']) expect(safeServiceUrl(url)).toBeNull();
  expect(safeServiceUrl('https://example.com/service/123')).toBe('https://example.com/service/123');
 });
 it('does not skip or reopen service request states', () => {
  expect(requestTransitionAllowed('PENDING', 'COMPLETED')).toBe(false);
  expect(requestTransitionAllowed('COMPLETED', 'IN_PROGRESS')).toBe(false);
  expect(requestTransitionAllowed('BOOKED', 'IN_PROGRESS')).toBe(true);
 });
 it('keeps incomplete plans visible as attention', () => {
  expect(consumerPlanStatus('active', true)).toBe('ATTENTION');
  expect(consumerPlanStatus('draft', false)).toBe('ATTENTION');
  expect(consumerPlanStatus('active', false)).toBe('RUNNING');
 });
});

