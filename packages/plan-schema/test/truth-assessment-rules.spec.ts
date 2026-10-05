import {describe,it,expect} from 'vitest';
import {evaluateTruthRules,type TruthRule} from '../src/truth-assessment-rules';
describe('verified deterministic assessment',()=>{
 const rules:TruthRule[]=[{kind:'THRESHOLD',factKey:'remaining',field:['days'],operator:'LTE',threshold:3},{kind:'TIME',factKey:'event',field:['start'],leadSeconds:60}];
 it('keeps missing or unverified facts unknown',()=>{expect(evaluateTruthRules([],rules,'2026-10-04T00:00:00Z').map(row=>row.matched)).toEqual([null,null]);expect(evaluateTruthRules([{factKey:'remaining',value:{days:0},verified:false,observedAt:'2026-10-03T00:00:00Z',evidenceRefs:[]}],rules,'2026-10-04T00:00:00Z')[0].matched).toBeNull();});
 it('uses actual numbers and explicit time offsets',()=>{
  const facts=[{factKey:'remaining',value:{days:2},verified:true,observedAt:'2026-10-03T00:00:00Z',evidenceRefs:['truth:1']},{factKey:'event',value:{start:'2026-10-04T00:00:30Z'},verified:true,observedAt:'2026-10-03T00:00:00Z',evidenceRefs:['truth:2']}];
  expect(evaluateTruthRules(facts,rules,'2026-10-04T00:00:00Z').map(row=>row.matched)).toEqual([true,true]);
 });
});
