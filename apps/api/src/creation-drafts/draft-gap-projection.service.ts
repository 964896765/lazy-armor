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
 constructor(private readonly drafts: CreationDraftsService, private readonly readiness: ReadinessEvidenceService, private readonly catalog: RuntimeCatalogRegistryService, @Inject(DATABASE) private readonly db: InjectedDatabase) {}
 async project(userId: string, draftId: string) {
  const draft = await this.drafts.get(userId, draftId);
  const base = { draftId, draftVersion: draft.version, draftState: draft.state, evaluatedAt: new Date().toISOString(), authority: 'CreationDraft' };
  if (draft.scenarioKey === '__pending__') return { ...base, state: 'NEEDS_SCENARIO', missingFacts: [], capabilityGaps: [], serviceOptions: [], reasons: ['SCENARIO_NOT_RESOLVED'], nextActions: [{ label: '补充需求', path: `/chat?mode=plan&draftId=${draftId}` }] };
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
  for (const ref of conversation?.contextRefs ?? []) if (ref.type === 'ExternalServiceReference') {
    const row = (await this.db.select().from(externalServiceReferences).where(and(eq(externalServiceReferences.id, ref.id), eq(externalServiceReferences.userId, userId))).limit(1))[0];
    external.push({ sourceRef: ref, title: row?.title ?? '外部引用已失效', status: row ? 'NOT_VERIFIED' : 'UNAVAILABLE', satisfiesCapability: false, primaryAction: { label: '查看引用', path: `/external-service-detail?id=${ref.id}` } });
  }
  return { ...base, state: evidence.readiness.state, readiness: evidence.product, missingFacts: evidence.missingFacts, capabilityGaps, subjectRequired: !draft.subject, serviceOptions: [...offerings.map(({ offering }) => ({ sourceRef: { type: 'ServiceOffering', id: offering.id }, title: offering.title, status: 'PUBLISHED_OFFERING_ONLY', satisfiesCapability: false, primaryAction: { label: '查看相关服务', path: `/service-detail?id=${offering.id}` } })), ...external], reasons: [...evidence.readiness.reasons, ...(!draft.subject ? ['SUBJECT_NOT_SELECTED'] : []), ...(scenario.revision !== draft.scenarioRevision ? ['SCENARIO_REVISION_CHANGED'] : []), ...evidence.missingFacts.map(key => `MISSING_FACT:${key}`), ...capabilityGaps.map(item => `MISSING_CAPABILITY:${item.capabilityKey}`)], nextActions: [{ label: '补充需求与资源', path: `/chat?mode=plan&draftId=${draftId}` }] };
 }
}
