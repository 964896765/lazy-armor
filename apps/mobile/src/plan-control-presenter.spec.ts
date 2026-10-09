import {describe,expect,it} from 'vitest';
import {controlActionLabel,controlResultLabel,controlTitle,informationStatus} from './plan-control-presenter';
describe('Plan control human semantics',()=>{
 it('uses capability over legacy publish semantics and keeps original Goal out of mutation',()=>{
  const name='创建每日定时计划：先用本机日历读取确认既有日程，再创建一条私密日历日程';
  expect(controlTitle(name,'calendar.event.create',true)).toBe('定时创建日历事项');
  expect(controlActionLabel('calendar.event.create','发布内容')).toBe('创建日历事项');
 });
 it('does not equate executor success with verified outcome',()=>{
  const record={id:'e',planVersionId:'v',status:'succeeded',createdAt:'2026-10-07T02:38:00Z',resultSummary:'All actions completed successfully',verificationState:'NOT_VERIFIED',capabilityIds:['calendar.event.create']};
  expect(controlResultLabel(record)).toBe('本次处理已完成');
  expect(controlResultLabel({...record,verificationState:'VERIFIED'})).toBe('日历事项已创建并核对');
  expect(controlResultLabel({...record,status:'failed',verificationState:'VERIFIED'})).toBe('本次未完成');
  expect(controlResultLabel({...record,verificationState:'OUTCOME_UNKNOWN'})).toContain('暂不会重复执行');
 });
 it('retains stale and conflicting Truth status instead of marking fresh',()=>{
  const info={factKey:'f',label:'日程',sourceLabel:'本机日历',state:'STALE',verified:true,observedAt:null,truthVersionId:'v',itemCount:3,maximumAgeSeconds:60};
  expect(informationStatus(info)).toContain('过期');expect(informationStatus({...info,state:'CONFLICT'})).toContain('冲突');
 });
});
