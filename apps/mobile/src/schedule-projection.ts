import type {TimelineItem} from '@lazy-armor/plan-schema';
import {todoRoute,todoTypeLabel,type TodoItem} from './todo-presenter';
import {messageChannel} from './message-presenter';
import {notificationDeepLink} from './consumer-error-presenter';
export type ScheduleSection='需要你处理'|'正在进行'|'接下来'|'最新动态';
export interface ScheduleRow extends TimelineItem {section:ScheduleSection}
export interface ScheduleMessage {messageParamsJson?:Record<string,unknown>|null;id:string;title:string;body:string;eventType:string;createdAt:string;executionId?:string|null;approvalRequestId?:string|null;connectionId?:string|null}
export function scheduleRows(timeline:TimelineItem[],attention:TodoItem[],messages:ScheduleMessage[],date?:string,timeZone='Asia/Shanghai'):ScheduleRow[]{
 const inDate=(at:string)=>!date||new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at))===date;
 const rows:ScheduleRow[]=timeline.map(item=>({...item,section:item.kind==='ATTENTION'||/需要|待处理|待确认|待审批|待核实|异常|有问题/.test(item.status)?'需要你处理':/进行|运行|等待|处理中/.test(item.status)?'正在进行':item.statusGroup==='COMPLETED'?'最新动态':'接下来'}));
 for(const item of attention){if(item.status!=='OPEN'&&!inDate(item.createdAt))continue;const path=todoRoute(item);if(!path)continue;if(rows.some(r=>item.executionId&&r.sourceRef.type==='Execution'&&r.sourceRef.id===item.executionId))continue;rows.push({id:'todo:'+item.id,kind:'ATTENTION',title:item.planName||item.summary,subtitle:item.summary,scheduledAt:null,occurredAt:item.createdAt,statusGroup:item.status==='OPEN'?'INCOMPLETE':'COMPLETED',status:item.status==='OPEN'?todoTypeLabel(item.type):'已处理',sourceRef:{type:'Attention',id:item.id},primaryAction:{label:'查看事项',path},section:'需要你处理'});}
 for(const message of messages){if(!inDate(message.createdAt)||messageChannel(message.eventType)==='system')continue;rows.push({id:'message:'+message.id,kind:'REMINDER',title:message.title,subtitle:message.body,scheduledAt:null,occurredAt:message.createdAt,statusGroup:'INCOMPLETE',status:'动态',sourceRef:{type:'Notification',id:message.id},primaryAction:{label:'查看动态',path:notificationDeepLink(message)||'/schedule'},section:'最新动态'});}
 return rows;
}
