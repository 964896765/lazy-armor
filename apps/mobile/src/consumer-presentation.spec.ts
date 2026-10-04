import { describe, expect, it } from 'vitest';
import { ConsumerPresentationMapper as mapper } from './consumer-presentation';
describe('consumer presentation boundary',()=>{
 it('translates codes and removes internal identifiers without fabricating success',()=>{
  expect(mapper.reason('SCENARIO_NOT_RESOLVED')).toBe('还需要明确计划类型');
  expect(mapper.reason('OUTCOME_UNVERIFIED')).not.toContain('OUTCOME_UNVERIFIED');
  expect(mapper.error(new Error('OAuth configuration is missing'))).toBe('当前服务暂未开放，请稍后再试');
  expect(mapper.text('Execution ID 01a101e4-44ff-732a-ba00-15ea315d3ae2')).not.toContain('01a101e4');
  expect(mapper.reason('UNKNOWN')).toBe('状态待检查');
 });
 it('preserves ordinary user prose and localizes time',()=>{
  expect(mapper.text('请分析 my_notes 文件里的安排')).toBe('请分析 my_notes 文件里的安排');
  expect(mapper.text('下次：2026-10-03T12:00:00.000Z')).not.toContain('T12:00');
  expect(mapper.time(null)).toBe('未定时');
  expect(mapper.dateTime('invalid')).toBe('时间待确认');
 });
});
