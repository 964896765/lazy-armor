import {FactDemandResolverService} from '../fact-demands/fact-demand-resolver.service';
import {LOCAL_CAPABILITY_CATALOG,LOCAL_RUNTIME_CAPABILITY_MAP,scenarioContractV2ByKey,type ScenarioGoalSpec} from '@lazy-armor/plan-schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { consumerConversations, externalServiceReferences, serviceOfferings, serviceProviderProfiles } from '@lazy-armor/database';
import { productDomain } from '@lazy-armor/plan-schema';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CreationDraftsService } from './creation-drafts.service';
import { ReadinessEvidenceService } from '../runtime-catalog/readiness-evidence.service';
import { RuntimeCatalogRegistryService } from '../runtime-catalog/runtime-catalog-registry.service';

/** Read projection only. Truth, capability readiness and service state retain their existing authorities. */
@Injectable()
export class DraftGapProjectionService {
 constructor(private readonly sourceResolver:FactDemandResolverService,private readonly drafts: CreationDraftsService, private readonly readiness: ReadinessEvidenceService, private readonly catalog: RuntimeCatalogRegistryService, @Inject(DATABASE) private readonly db: InjectedDatabase) {}
 async project(userId: string, draftId: string) {
  const draft = await this.drafts.get(userId, draftId);
  const base = { draftId, draftVersion: draft.version, draftState: draft.state, evaluatedAt: new Date().toISOString(), authority: 'CreationDraft' };
  if (draft.scenarioKey === '__pending__') return { ...base, state: 'NEEDS_SCENARIO', missingFacts: [], capabilityGaps: [], serviceOptions: [], reasons: ['SCENARIO_NOT_RESOLVED'], nextActions: [{ label: '补充需求', path: `/chat?mode=plan&draftId=${draftId}` }] };
  const contract=scenarioContractV2ByKey(draft.scenarioKey);
  let sourceResolverResults:unknown[]=[];
  let sourceOptions:Array<{sourceId:string;demandIds:string[];canSelect:boolean;selected:boolean;name:string;status:string;evidenceRefs:readonly string[];primaryAction:{label:string;path:string}}>=[];
  let sourceAssessment:Pick<Awaited<ReturnType<FactDemandResolverService['resolve']>>,'acquisitionCoverage'|'stateAssessment'|'nextBestAction'>|null=null;
  let sourceResolutionState='NEEDS_SUBJECT_OR_GOAL';
  if(contract&&draft.subject&&contract.goal.supportedIntents.includes(draft.goal.intent)){const result=await this.sourceResolver.resolve(userId,{scenarioKey:draft.scenarioKey,scenarioRevision:draft.scenarioRevision,goal:draft.goal as ScenarioGoalSpec,subject:draft.subject},draft.sourceChoices.length?Object.fromEntries(draft.sourceChoices.map(choice=>[choice.factKey,choice.selection.sourceId])):undefined);sourceResolverResults=[...result.sourceResolverResults];sourceAssessment={acquisitionCoverage:result.acquisitionCoverage,stateAssessment:result.stateAssessment,nextBestAction:result.nextBestAction};sourceOptions=result.demands.flatMap(demand=>demand.candidateSources.map(source=>({sourceId:source.sourceId,demandIds:[demand.demandId],canSelect:source.usable,selected:draft.sourceChoices.some(choice=>choice.demandId===demand.demandId&&choice.selection.sourceId===source.sourceId),name:source.kind==='NATIVE_DEVICE'?(LOCAL_CAPABILITY_CATALOG.find(spec=>LOCAL_RUNTIME_CAPABILITY_MAP[spec.key]===source.capabilityKey)?.name??'本机来源'):source.kind==='PROVIDER_CONNECTION'?'云端数据来源':source.kind==='TRUSTED_DEVICE'?'已关联设备来源':'已记录的事实来源',status:source.usable?'已取得可读取证据':'需要补充授权或检查来源',evidenceRefs:source.evidenceRefs,primaryAction:{label:'管理来源',path:'/resources'}})));const options=new Map<string,typeof sourceOptions[number]>();for(const option of sourceOptions){const existing=options.get(option.sourceId);if(existing){existing.demandIds.push(...option.demandIds);existing.canSelect=existing.canSelect&&option.canSelect;existing.selected=existing.selected&&option.selected;}else options.set(option.sourceId,option);}sourceOptions=[...options.values()];sourceResolutionState='RESOLVED';}
  const scenario = this.catalog.getScenario(draft.scenarioKey);
  const evidence = await this.readiness.projectScenarioRuntimeEvidence(userId, scenario);
  const required = [...scenario.sourceRequirements, ...scenario.actionRequirements].filter(item => !item.optional);
  const capabilityGaps = required.flatMap(requirement => {
    const candidates = evidence.capabilities.filter(item => item.capabilityKey === requirement.capabilityKey);
    if (candidates.some(item => item.usable)) return [];
    return [{ capabilityKey: requirement.capabilityKey, reasons: candidates.length ? [...new Set(candidates.flatMap(item => item.reasons))] : ['NO_CAPABILITY_PROVIDER'], candidates, nextAction: { label: '补充资源', path: '/resources' } }];
  });
  const offerings = await this.db.select({ offering: serviceOfferings }).from(serviceOfferings).innerJoin(serviceProviderProfiles, eq(serviceOfferings.providerProfileId, serviceProviderProfiles.id)).where(and(eq(serviceOfferings.status, 'PUBLISHED'), eq(serviceProviderProfiles.status, 'ACTIVE'), eq(serviceOfferings.domain, productDomain(scenario.domain)))).limit(20);
  const conversation = draft.conversationId ? (await this.db.select().from(consumerConversations).where(and(eq(consumerConversations.id, draft.conversationId), eq(consumerConversations.userId, userId))).limit(1))[0] : null;
  const external = [];
  for (const ref of conversation?.contextRefs ?? []) if ((ref.type === 'ExternalServiceReference'||ref.type==='ExternalReference')) {
    const row = (await this.db.select().from(externalServiceReferences).where(and(eq(externalServiceReferences.id, ref.id), eq(externalServiceReferences.userId, userId))).limit(1))[0];
    external.push({ sourceRef: ref, title: row?.title ?? '外部引用已失效', status: row ? 'NOT_VERIFIED' : 'UNAVAILABLE', satisfiesCapability: false, primaryAction: { label: '查看引用', path: `/external-service-detail?id=${ref.id}` } });
  }
  return { ...base, sourceOptions,sourceAssessment,sourceResolverResults,sourceResolutionState,state: evidence.readiness.state, readiness: evidence.product, missingFacts: evidence.missingFacts, capabilityGaps, subjectRequired: !draft.subject, serviceOptions: [...offerings.map(({ offering }) => ({ sourceRef: { type: 'ServiceOffering', id: offering.id }, title: offering.title, status: 'PUBLISHED_OFFERING_ONLY', satisfiesCapability: false, primaryAction: { label: '查看相关服务', path: `/service-detail?id=${offering.id}` } })), ...external], reasons: [...evidence.readiness.reasons, ...(!draft.subject ? ['SUBJECT_NOT_SELECTED'] : []), ...(scenario.revision !== draft.scenarioRevision ? ['SCENARIO_REVISION_CHANGED'] : []), ...evidence.missingFacts.map(key => `MISSING_FACT:${key}`), ...capabilityGaps.map(item => `MISSING_CAPABILITY:${item.capabilityKey}`)], nextActions: [{ label: '补充需求与资源', path: `/chat?mode=plan&draftId=${draftId}` }] };
 }
}
