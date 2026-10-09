import {describe,it,expect} from 'vitest';
import {scheduleRows} from './schedule-projection';
import type {TimelineItem} from '@lazy-armor/plan-schema';
import type {TodoItem} from './todo-presenter';
const item:TimelineItem={id:'run',kind:'PLAN_RUN',title:'计划',subtitle:'',scheduledAt:null,occurredAt:'2026-10-05T16:00:00Z',statusGroup:'INCOMPLETE',status:'进行中',sourceRef:{type:'Execution',id:'execution'},primaryAction:{label:'查看',path:'/executions/execution'}};
describe('unified schedule projection',()=>{
 it('keeps local date boundaries, business activity and system security separate',()=>{
  const rows=scheduleRows([item],[],[{id:'business',title:'结果',body:'已完成',eventType:'execution_succeeded',createdAt:item.occurredAt,executionId:'execution'},{id:'security',title:'登录',body:'',eventType:'login_success',createdAt:item.occurredAt}], '2026-10-06');
  expect(rows.map(r=>r.section)).toEqual(['正在进行','最新动态']);expect(rows[1].primaryAction.path).toBe('/executions/execution');
  expect(scheduleRows([],[],[{id:'previous',title:'昨天',body:'',eventType:'execution_failed',createdAt:'2026-10-05T15:59:59Z'}],'2026-10-06')).toEqual([]);
 });
 it('uses existing approval routes and avoids duplicating execution attention',()=>{
  const todo:TodoItem={id:'a',type:'APPROVAL',sourceId:'a',summary:'请确认',priority:'P1',status:'OPEN',createdAt:item.occurredAt,planId:null,planName:null,executionId:'execution',approvalRequestId:'approval',reconciliationCaseId:null,connectionId:null};
  expect(scheduleRows([item],[todo],[])).toHaveLength(1);
  const rows=scheduleRows([],[todo],[]);expect(rows[0].section).toBe('需要你处理');expect(rows[0].primaryAction.path).toBe('/approvals/approval');
 });
});
