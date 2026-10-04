import { describe, expect, it, vi } from 'vitest';
import { SCENARIO_DEFINITIONS } from '@lazy-armor/plan-schema';
import { ConsumerService } from '../src/consumer/consumer.service';
function service(rows:unknown[][]=[]){
 const db={select:()=>({from:()=>({where:()=>Promise.resolve(rows.shift()??[])})})};
 const connections={list:vi.fn().mockResolvedValue([])};
 const devices={list:vi.fn().mockResolvedValue([])};
 const connectors={listPublic:vi.fn().mockResolvedValue([])};
 const plans={list:vi.fn().mockResolvedValue([])};
 const templates={list:vi.fn().mockResolvedValue([])};
 const instance=new ConsumerService(db as never,{} as never,plans as never,connections as never,devices as never,connectors as never,templates as never,{} as never,{} as never);
 return {instance,connections,connectors};
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
  const now=Date.now();const {instance,connections}=service([
   [{capabilityKey:'valid',status:'HEALTHY',checkedAt:new Date(now-1000),validUntil:new Date(now+60000)},
    {capabilityKey:'unbounded',status:'HEALTHY',checkedAt:new Date(now-1000),validUntil:null},
    {capabilityKey:'revoked',status:'HEALTHY',checkedAt:new Date(now-1000),validUntil:new Date(now+60000)}],
   [{capabilityKey:'valid',status:'GRANTED',revokedAt:null},{capabilityKey:'unbounded',status:'GRANTED'}, {capabilityKey:'revoked',status:'GRANTED',revokedAt:new Date(now-1000)}]
  ]);
  connections.list.mockResolvedValue([{id:'x',connectorId:'public_http_json',connectorName:'JSON',externalAccountName:'接口',status:'connected',lastCheckedAt:null}]);
  const [row]=await instance.resources('user');expect(row.capabilities).toEqual(['valid']);expect(row.status).toBe('已添加');
 });
});
