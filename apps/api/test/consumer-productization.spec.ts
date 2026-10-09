import { describe, expect, it, vi } from 'vitest';
import { SCENARIO_DEFINITIONS } from '@lazy-armor/plan-schema';
import { ConsumerService } from '../src/consumer/consumer.service';
function service(rows:unknown[][]=[]){
 const db={select:()=>{const data=rows.shift()??[];const chain={from:()=>chain,where:()=>chain,orderBy:()=>chain,limit:()=>Promise.resolve(data),then:(resolve:(value:unknown[])=>unknown)=>Promise.resolve(data).then(resolve)};return chain;}};
 const connections={list:vi.fn().mockResolvedValue([])};
 const devices={list:vi.fn().mockResolvedValue([])};
 const connectors={listPublic:vi.fn().mockResolvedValue([])};
 const plans={list:vi.fn().mockResolvedValue([])};
 const templates={list:vi.fn().mockResolvedValue([])};
 const usability={resolveConnection:vi.fn().mockResolvedValue({capabilities:[]})};
 const modules={get:()=>usability};
 const instance=new ConsumerService(db as never,{} as never,plans as never,connections as never,devices as never,connectors as never,templates as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,modules as never,{} as never,{} as never);
 return {instance,connections,connectors,usability};
}
describe('productization authoritative projections',()=>{
 it('keeps the complete canonical catalog visible without any connected resource',async()=>{
  const {instance}=service();const library=await instance.planLibrary('user');
  expect(library.templates.filter(row=>row.sourceRef.type==='Scenario')).toHaveLength(SCENARIO_DEFINITIONS.length);
  expect(library.templates.every(row=>row.primaryAction.path.startsWith('/chat?mode=plan&'))).toBe(true);
 });
 it('excludes manual and internal service providers from resources',async()=>{
  const {instance,connectors,connections}=service();
  connectors.listPublic.mockResolvedValue(['manual','internal','public_http_json'].map(key=>({key,name:key,description:'',connectable:true,draftOnly:false,authentication:{type:'none'}})));
  connections.list.mockResolvedValue([{id:'x',connectorId:'manual'}]);
  const rows=await instance.resources('user');expect(rows.map(row=>row.sourceRef.id)).toEqual(['public_http_json']);
 });
 it('requires current health and non-revoked grants to project usable capabilities',async()=>{
  const {instance,connections,connectors,usability}=service();
  connectors.listPublic.mockResolvedValue([{key:'public_http_json',providerType:'file'}]);
  usability.resolveConnection.mockResolvedValue({capabilities:[
   {key:'valid',name:'有效读取',operation:'read',health:'HEALTHY',usable:true,reasons:[]},
   {key:'unbounded',name:'过期检查',operation:'read',health:'UNKNOWN',usable:false,reasons:['CAPABILITY_HEALTH_EVIDENCE_STALE']},
   {key:'revoked',name:'撤回授权',operation:'read',health:'HEALTHY',usable:false,reasons:['CAPABILITY_GRANT_REVOKED']},
  ]});
  connections.list.mockResolvedValue([{id:'x',connectorId:'public_http_json',connectorName:'JSON',externalAccountName:'接口',status:'connected',lastCheckedAt:null}]);
  const [row]=await instance.resources('user');expect(row.capabilities).toEqual(['valid']);expect(row.status).toBe('已连接');
  expect(row.capabilitySummary).toMatchObject({total:3,available:1});expect(usability.resolveConnection).toHaveBeenCalledWith('user','x');
 });
});
