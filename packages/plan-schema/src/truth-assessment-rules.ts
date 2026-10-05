export interface VerifiedRuleFact { factKey:string; value:unknown; verified:boolean; observedAt:string;evidenceRefs:readonly string[] }
export type TruthRule = {kind:'TIME';factKey:string;field:readonly string[];leadSeconds:number} | {kind:'THRESHOLD';factKey:string;field:readonly string[];operator:'LTE'|'GTE';threshold:number} | {kind:'STATE';factKey:string;field:readonly string[];equals:string};
function field(value:unknown,path:readonly string[]):unknown { let current=value;for(const key of path){if(!current||typeof current!=='object')return undefined;current=(current as Record<string,unknown>)[key];}return current; }
/** Rules consume verified Truth only; missing values remain unknown, never zero/false. */
export function evaluateTruthRules(facts:readonly VerifiedRuleFact[],rules:readonly TruthRule[],evaluatedAt:string) {
 const now=Date.parse(evaluatedAt);
 return rules.map(rule=>{
  const fact=facts.filter(fact=>fact.factKey===rule.factKey&&fact.verified&&Date.parse(fact.observedAt)<=now).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
  const value=fact?field(fact.value,rule.field):undefined;let matched:boolean|null=null;
  if(rule.kind==='TIME'&&typeof value==='string'&&Number.isFinite(Date.parse(value))&&Number.isFinite(now)&&Number.isFinite(rule.leadSeconds)&&rule.leadSeconds>=0)matched=now>=Date.parse(value)-rule.leadSeconds*1000;
  if(rule.kind==='THRESHOLD'&&typeof value==='number'&&Number.isFinite(value)&&Number.isFinite(rule.threshold))matched=rule.operator==='LTE'?value<=rule.threshold:value>=rule.threshold;
  if(rule.kind==='STATE'&&typeof value==='string')matched=value===rule.equals;
  return {rule,matched,evidenceRefs:fact?.evidenceRefs??[]};
 });
}
