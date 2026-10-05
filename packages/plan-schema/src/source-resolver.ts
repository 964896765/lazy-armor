import type {SourceCandidateEvidence} from './fact-demand';
export interface SourceResolverDimensions {authority:number|null;freshness:number|null;reliability:number|null;verificationAbility:boolean|null;privacyCost:number|null;cost:number|null;latencyMs:number|null;}
/** Unknown evidence ranks below proven evidence, never receives an optimistic default. */
export function sourceResolverRank(source:SourceCandidateEvidence,usable:boolean,verified:boolean,acquired:boolean):number {
 const e=source.resolverEvidence;return (usable?1000000:0)+(verified?100000:acquired?10000:0)+
 Math.max(0,Math.min(1,e?.authority??0))*1000+Math.max(0,Math.min(1,e?.freshness??0))*100+
 Math.max(0,Math.min(1,e?.reliability??0))*10+(e?.verificationAbility===true?5:0)-
 Math.min(1,Math.max(0,e?.privacyCost??1))-Math.min(1,Math.max(0,e?.cost??1))-
 Math.min(60000,Math.max(0,e?.latencyMs??source.estimatedLatencyMs??60000))/60000;
}
export interface SourceResolverResult {factKey:string;selectedSourceId:string|null;state:string;evaluatedAt:string;candidates:readonly {sourceId:string;usable:boolean;rank:number;evidenceRefs:readonly string[];reasonCodes:readonly string[]}[];}
