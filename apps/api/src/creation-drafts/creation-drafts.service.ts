import {z} from 'zod';
import {ModuleRef} from '@nestjs/core';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { consumerConversations, creationDrafts, planOfferSnapshots, planCreationContracts } from '@lazy-armor/database';
import {
  buildPersistentPlanOffer, catalogHash, definitionHash, persistentPlanOfferRequestSchema,compileScenarioPlan,
  coreProductTemplateByKey,
  CREATION_DRAFT_CONTRACT_VERSION,
  assessPlanAvailability,
  buildSourceSelection,
  creationDraftInputSchema,creationDraftSourceChoiceSchema,
  scenarioContractV2ByKey,
  scenarioByKey,
  type CreationDraft,
  type CreationDraftResumeAssessment,
  type CreationDraftResumeState,
  type CreationDraftSourceChoice,
  type CreationDraftSourceChoiceInput,
  type CreationDraftStage,
  type CreationDraftState,
  type FactDemandProjection,
  type ScenarioGoalSpec,
  type ScenarioResourceSubject,
  type SourceSelection,
} from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, lte } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { FactDemandResolverService } from '../fact-demands/fact-demand-resolver.service';
import type { PlanExecutor } from '../plans/plans.service';
import type { SaveCreationDraftDto } from './dto';

const CREATION_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class CreationDraftsService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly factDemands: FactDemandResolverService,
    private readonly moduleRef:ModuleRef,
  ) {}

  async upsert(userId: string, raw: SaveCreationDraftDto): Promise<CreationDraft> {
    const input = creationDraftInputSchema.parse(raw);
    const contract = scenarioContractV2ByKey(input.scenarioKey);
    if (!contract || contract.scenario.revision !== input.scenarioRevision) {
      throw new NotFoundException('Scenario Contract V2 not available for this revision');
    }
    if (!contract.goal.supportedIntents.includes(input.goal.intent)) {
      throw new BadRequestException('Goal intent is not allowed by the Scenario Contract');
    }

    const sourceChoices = input.subject
      ? await this.resolveSourceChoices(userId, input.scenarioKey, input.scenarioRevision, input.goal, input.subject, input.sourceChoices ?? [])
      : this.requireNoSourceChoices(input.sourceChoices);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + CREATION_DRAFT_TTL_MS);
    const existing = await this.findByKey(userId, input.scenarioKey);

    if (existing) {
      if (input.version !== undefined && input.version !== existing.version) {
        throw new ConflictException('CreationDraft version mismatch');
      }
      await this.db.update(creationDrafts).set({
        scenarioRevision: input.scenarioRevision,
        stage: input.stage,
        goalJson: input.goal as unknown as Record<string, unknown>,
        subjectJson: (input.subject ?? null) as Record<string, unknown> | null,
        sourceChoicesJson: sourceChoices as unknown as Record<string, unknown>[],
        selectedOfferKey: input.selectedOfferKey ?? null,
        version: existing.version + 1,
        state: 'ACTIVE',
        updatedAt: now,
        expiresAt,
      }).where(eq(creationDrafts.draftId, existing.draftId));
      return this.toEntity((await this.findById(existing.draftId))!);
    }

    if (input.version !== undefined && input.version !== 0) {
      throw new ConflictException('CreationDraft version mismatch');
    }
    const draftId = newId();
    await this.db.insert(creationDrafts).values({
      draftId,
      userId,
      scopeKey: `scenario:${input.scenarioKey}`,
      scenarioKey: input.scenarioKey,
      scenarioRevision: input.scenarioRevision,
      stage: input.stage,
      goalJson: input.goal as unknown as Record<string, unknown>,
      subjectJson: (input.subject ?? null) as Record<string, unknown> | null,
      sourceChoicesJson: sourceChoices as unknown as Record<string, unknown>[],
      selectedOfferKey: input.selectedOfferKey ?? null,
      version: 1,
      state: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
    return this.toEntity((await this.findById(draftId))!);
  }

  async bindConversation(userId: string, conversationId: string, tx: PlanExecutor, input: { draftId?: string; scenarioKey?: string; productTemplateKey?:string } = {}) {
    const now = new Date();
    if (input.draftId) {
      const row = (await tx.select().from(creationDrafts).where(and(eq(creationDrafts.draftId, input.draftId), eq(creationDrafts.userId, userId))).for('update'))[0];
      if (!row) throw new NotFoundException('CreationDraft not found');
      if (row.state !== 'ACTIVE' || row.expiresAt <= now) throw new ConflictException('CreationDraft is not active');
      if (row.conversationId) {
        const linked = (await tx.select().from(consumerConversations).where(eq(consumerConversations.id, row.conversationId)))[0];
        if (!linked || linked.deletedAt) throw new ConflictException('Conversation has been deleted');
        return { draftId: row.draftId, conversationId: row.conversationId };
      }
      await tx.update(creationDrafts).set({ scopeKey: `conversation:${conversationId}`, conversationId, updatedAt: now, version: row.version + 1 }).where(eq(creationDrafts.draftId, row.draftId));
      return { draftId: row.draftId, conversationId };
    }
    const scenario = input.scenarioKey ? scenarioByKey(input.scenarioKey) : null;
    if (input.scenarioKey && !scenario) throw new NotFoundException('Scenario not found');
    const productTemplate=input.productTemplateKey?coreProductTemplateByKey(input.productTemplateKey):null;
    const draftId = newId();
    await tx.insert(creationDrafts).values({ draftId, userId, scopeKey: `conversation:${conversationId}`, conversationId, scenarioKey: scenario?.key ?? '__pending__', scenarioRevision: scenario?.revision ?? 1, stage: 1, goalJson: { intent: 'DESCRIBE_REQUIREMENT', description: productTemplate?.intent ?? '待补充计划需求', constraints: productTemplate ? {productTemplateKey:productTemplate.key,productCatalogVersion:'1',candidateScenarioKeys:productTemplate.scenarioMapping.scenarioKeys.join(',')} : {} }, subjectJson: null, sourceChoicesJson: [], selectedOfferKey: null, version: 1, state: 'ACTIVE', createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + CREATION_DRAFT_TTL_MS) });
    return { draftId, conversationId };
  }

  async recordConversationGoal(userId: string, draftId: string, description: string, tx: PlanExecutor) {
    const row = (await tx.select().from(creationDrafts).where(and(eq(creationDrafts.draftId, draftId), eq(creationDrafts.userId, userId))).for('update'))[0];
    if (!row || !['ACTIVE', 'COMPLETED'].includes(row.state) || row.expiresAt <= new Date()) throw new ConflictException('CreationDraft expired or is not active');
    await tx.update(creationDrafts).set({ state: 'ACTIVE', expiresAt: new Date(Date.now() + CREATION_DRAFT_TTL_MS), goalJson: { ...row.goalJson, description: description.slice(0, 500), constraints: { ...(row.goalJson.constraints as Record<string, unknown> ?? {}), userInput: description } }, proposalMessageId: null, stage: 1, version: row.version + 1, updatedAt: new Date() }).where(eq(creationDrafts.draftId, draftId));
  }

  async recordConversationProposal(userId: string, draftId: string, messageId: string, proposal: { scenarioKey?: string | null; scenarioRevision?: number | null; intentSummary?: string }, tx: PlanExecutor) {
    const row = (await tx.select().from(creationDrafts).where(and(eq(creationDrafts.draftId, draftId), eq(creationDrafts.userId, userId))).for('update'))[0];
    if (!row || row.state !== 'ACTIVE' || row.expiresAt <= new Date()) throw new ConflictException('CreationDraft expired or is not active');
    const scenario = proposal.scenarioKey ? scenarioByKey(proposal.scenarioKey) : null;
    if (!scenario || scenario.revision !== proposal.scenarioRevision) throw new ConflictException('Scenario revision changed');
    await tx.update(creationDrafts).set({ scenarioKey: scenario.key, scenarioRevision: scenario.revision, goalJson: { ...row.goalJson, description: proposal.intentSummary?.slice(0, 500) || row.goalJson.description }, proposalMessageId: messageId, stage: 5, version: row.version + 1, updatedAt: new Date() }).where(eq(creationDrafts.draftId, draftId));
  }

  async completeConversation(userId: string, draftId: string, messageId: string, tx: PlanExecutor) {
    const row = (await tx.select().from(creationDrafts).where(and(eq(creationDrafts.draftId, draftId), eq(creationDrafts.userId, userId))).for('update'))[0];
    if (!row || row.state !== 'ACTIVE' || row.expiresAt <= new Date() || row.proposalMessageId !== messageId) throw new ConflictException('CreationDraft changed or expired; regenerate the proposal');
    await tx.update(creationDrafts).set({ state: 'COMPLETED', version: row.version + 1, updatedAt: new Date() }).where(eq(creationDrafts.draftId, draftId));
  }

  /** Freeze the confirmed draft sources against this exact immutable PlanVersion. */
  async freezeConversationSources(userId:string,draftId:string,created:{planId:string;planVersionId:string;definition:import('@lazy-armor/plan-schema').PlanDefinition},tx:PlanExecutor) {
    const row=(await tx.select().from(creationDrafts).where(and(eq(creationDrafts.draftId,draftId),eq(creationDrafts.userId,userId))).for('update'))[0];
    if(!row||row.state!=='COMPLETED')throw new ConflictException('请先确认当前计划草案');
    const choices=row.sourceChoicesJson as unknown as CreationDraftSourceChoice[];
    const parsed=persistentPlanOfferRequestSchema.safeParse({scenarioKey:row.scenarioKey,scenarioRevision:row.scenarioRevision,goal:row.goalJson,subject:row.subjectJson});
    if(!parsed.success){if(choices.length)throw new ConflictException('来源选择缺少有效需求合同');return null;}
    const pins=Object.fromEntries(choices.map(choice=>[choice.factKey,choice.selection.sourceId]));
    const resolved=await this.factDemands.resolve(userId,parsed.data,pins);
    if(choices.some(choice=>!resolved.demands.some(demand=>demand.demandId===choice.demandId&&demand.selectedSourceId===choice.selection.sourceId&&demand.sourceCurrentlyUsable)))throw new ConflictException('已选来源发生变化，请重新确认');
    const selected=resolved.demands.map(demand=>({demandId:demand.demandId,factKey:demand.factKey,selectedSourceId:demand.selectedSourceId,selectedSource:demand.selectedSource}));
    const scenario=scenarioByKey(row.scenarioKey);
    if(!scenario)throw new ConflictException('需求合同已变化');
    const offer=buildPersistentPlanOffer({request:parsed.data,demands:resolved.demands,contractHash:resolved.contractHash,strategyKey:scenario.defaultStrategy,planDefinitionHash:definitionHash(created.definition),generatedAt:resolved.evaluatedAt});
    const now=new Date(),snapshotId=newId(),contractId=newId();
    await tx.insert(planOfferSnapshots).values({id:snapshotId,userId,offerKey:catalogHash({draftId,planVersionId:created.planVersionId}),scenarioKey:row.scenarioKey,scenarioRevision:row.scenarioRevision,contractHash:resolved.contractHash,offerHash:catalogHash(offer),preconditionHash:offer.preconditionHash,goalJson:row.goalJson,subjectJson:row.subjectJson!,factDemandsJson:resolved.demands as unknown as Record<string,unknown>[],sourceResolutionJson:selected as unknown as Record<string,unknown>[],offerJson:offer as unknown as Record<string,unknown>,status:'CHOSEN',expiresAt:new Date(offer.expiresAt),chosenAt:now,invalidatedAt:null,createdAt:now});
    await tx.insert(planCreationContracts).values({id:contractId,userId,planId:created.planId,planVersionId:created.planVersionId,offerSnapshotId:snapshotId,idempotencyKey:`draft:${draftId}:${created.planVersionId}`,scenarioKey:row.scenarioKey,scenarioRevision:row.scenarioRevision,contractHash:resolved.contractHash,confirmationHash:catalogHash({draftId,draftVersion:row.version,definitionHash:definitionHash(created.definition),selected}),goalJson:row.goalJson,subjectJson:row.subjectJson!,factDemandsJson:resolved.demands as unknown as Record<string,unknown>[],sourceSelectionJson:selected as unknown as Record<string,unknown>[],offerJson:offer as unknown as Record<string,unknown>,createdAt:now});
    const compiled=compileScenarioPlan({scenarioKey:row.scenarioKey,scenarioRevision:row.scenarioRevision,strategy:scenario.defaultStrategy,subjectKey:parsed.data.subject.subjectKey,name:created.definition.name,mode:'DRAFT',readiness:{manualInputAvailable:true,observationPipelineAvailable:true,executionPipelineAvailable:true}});
    if(definitionHash(compiled.definition)===definitionHash(created.definition)){
      const {StrategyRuntimeService}=await import('../strategy-runtime/strategy-runtime.service');
      await this.moduleRef.get(StrategyRuntimeService,{strict:false}).bindInTransaction(userId,{planVersionId:created.planVersionId,scenarioKey:row.scenarioKey,scenarioRevision:row.scenarioRevision,strategy:scenario.defaultStrategy,subjectKey:parsed.data.subject.subjectKey},tx);
    }
    return {contractId,sourceSelections:selected};
  }

  async list(userId: string): Promise<CreationDraft[]> {
    const now = new Date();
    await this.db.update(creationDrafts).set({ state: 'EXPIRED', updatedAt: now })
      .where(and(eq(creationDrafts.userId, userId), eq(creationDrafts.state, 'ACTIVE'), lte(creationDrafts.expiresAt, now)));
    const rows = await this.db.select().from(creationDrafts)
      .where(and(eq(creationDrafts.userId, userId), eq(creationDrafts.state, 'ACTIVE')))
      .orderBy(desc(creationDrafts.updatedAt));
    return rows.map((row) => this.toEntity(row));
  }

  async get(userId: string, draftId: string): Promise<CreationDraft> {
    return this.toEntity(await this.findOwned(userId, draftId));
  }

  async resume(userId: string, draftId: string): Promise<CreationDraftResumeAssessment> {
    const draft = await this.findOwned(userId, draftId);
    if (draft.state !== 'ACTIVE') throw new ConflictException('CreationDraft is not active');
    const now = new Date();
    if (draft.expiresAt <= now) {
      await this.db.update(creationDrafts).set({ state: 'EXPIRED', updatedAt: now }).where(eq(creationDrafts.draftId, draftId));
      throw new ConflictException('CreationDraft expired');
    }
    const goal = draft.goalJson as unknown as ScenarioGoalSpec;
    const subject = draft.subjectJson as ScenarioResourceSubject | null;
    const reasonCodes: string[] = [];
    let state: CreationDraftResumeState;

    const contract = scenarioContractV2ByKey(draft.scenarioKey);
    if (!contract || contract.scenario.revision !== draft.scenarioRevision) {
      state = 'NEEDS_RECONFIRMATION';
      reasonCodes.push(draft.scenarioKey === '__pending__' ? 'SCENARIO_NOT_RESOLVED' : 'SCENARIO_CONTRACT_CHANGED');
    } else if (!subject) {
      state = 'NEEDS_SUBJECT';
    } else {
      const choices = draft.sourceChoicesJson as unknown as readonly CreationDraftSourceChoice[];
      if (choices.length === 0) {
        state = 'NEEDS_SOURCE_REVIEW';
        reasonCodes.push('SOURCE_CHOICES_REQUIRED');
      } else {
        let current: Awaited<ReturnType<FactDemandResolverService['resolve']>> | null;
        try {
          current = await this.factDemands.resolve(userId, { scenarioKey: draft.scenarioKey,
            scenarioRevision: draft.scenarioRevision, goal, subject },Object.fromEntries(choices.map(choice=>[choice.factKey,choice.selection.sourceId])));
        } catch {
          current = null;
        }
        if (!current) {
          state = 'NEEDS_RECONFIRMATION';
          reasonCodes.push('SUBJECT_OR_GOAL_INVALID');
        } else {
          const availability = assessPlanAvailability({
            expectedContractHash: current.contractHash,
            currentContractHash: current.contractHash,
            previousSelections: choices.map((choice) => ({ demandId: choice.demandId,
              selectedSourceId: choice.selection?.sourceId ?? null, selectedSource: choice.selection ?? null })),
            currentDemands: current.demands,
            evaluatedAt: current.evaluatedAt,
          });
          const usable = this.sourceChoicesUsable(choices, current.demands);
          if (!usable) {
            state = 'NEEDS_SOURCE_REVIEW';
            for (const code of availability.reasonCodes) if (code !== 'PLAN_PRECONDITIONS_CURRENT') reasonCodes.push(code);
            reasonCodes.push('SOURCE_CHOICE_NO_LONGER_USABLE');
          } else if (draft.selectedOfferKey) {
            const offerFresh = await this.offerFresh(userId, draft.selectedOfferKey, now);
            if (!offerFresh) { state = 'NEEDS_OFFER_REGENERATION'; reasonCodes.push('OFFER_EXPIRED'); }
            else state = 'READY';
          } else {
            state = 'READY';
          }
        }
      }
    }

    return Object.freeze({
      contractVersion: CREATION_DRAFT_CONTRACT_VERSION,
      draftId,
      state,
      reasonCodes: Object.freeze([...new Set(reasonCodes)]),
      scenario: Object.freeze({ key: draft.scenarioKey, revision: contract?.scenario.revision ?? draft.scenarioRevision,
        contractHash: contract?.definitionHash ?? '' }),
      goal,
      subject,
      currentStage: draft.stage as CreationDraftStage,
      selectedOfferKey: draft.selectedOfferKey,
      evaluatedAt: now.toISOString(),
    });
  }

  async discard(userId: string, draftId: string): Promise<CreationDraft> {
    const draft = await this.findOwned(userId, draftId);
    await this.db.update(creationDrafts).set({ state: 'DISCARDED', updatedAt: new Date() })
      .where(eq(creationDrafts.draftId, draft.draftId));
    return this.toEntity((await this.findById(draft.draftId))!);
  }

  async selectSources(userId:string,draftId:string,version:number,rawChoices:unknown[]){
    const draft=await this.get(userId,draftId);
    if(draft.state!=='ACTIVE'||Date.parse(draft.expiresAt)<=Date.now())throw new ConflictException('计划草案已失效');
    if(draft.version!==version)throw new ConflictException('草案已更新，请刷新后选择来源');
    if(!draft.subject)throw new BadRequestException('请先明确计划关联对象');
    const parsed=z.array(creationDraftSourceChoiceSchema).min(1).max(50).safeParse(rawChoices);
    if(!parsed.success)throw new BadRequestException("请选择有效的数据来源");
    const inputs=parsed.data;
    if(new Set(inputs.map(choice=>choice.demandId)).size!==inputs.length)throw new BadRequestException('同一需求只能选择一个来源');
    const existing=new Map(draft.sourceChoices.map(choice=>[choice.demandId,{demandId:choice.demandId,sourceId:choice.selection.sourceId}]));
    for(const input of inputs)existing.set(input.demandId,input);
    const choices=await this.resolveSourceChoices(userId,draft.scenarioKey,draft.scenarioRevision,draft.goal,draft.subject,[...existing.values()]);
    const [result]=await this.db.update(creationDrafts).set({sourceChoicesJson:choices as unknown as Record<string,unknown>[],selectedOfferKey:null,stage:Math.max(draft.stage,3),version:version+1,updatedAt:new Date()}).where(and(eq(creationDrafts.draftId,draftId),eq(creationDrafts.userId,userId),eq(creationDrafts.version,version),eq(creationDrafts.state,'ACTIVE')));
    if(result.affectedRows!==1)throw new ConflictException('草案已更新，请刷新后选择来源');
    return this.get(userId,draftId);
  }

  private requireNoSourceChoices(sourceChoices: readonly CreationDraftSourceChoiceInput[] | undefined): CreationDraftSourceChoice[] {
    if (sourceChoices && sourceChoices.length > 0) throw new BadRequestException('sourceChoices requires a subject');
    return [];
  }

  private async resolveSourceChoices(userId: string, scenarioKey: string, scenarioRevision: number,
    goal: ScenarioGoalSpec, subject: ScenarioResourceSubject, inputs: readonly CreationDraftSourceChoiceInput[]): Promise<CreationDraftSourceChoice[]> {
    const resolved = await this.factDemands.resolve(userId, { scenarioKey, scenarioRevision, goal, subject });
    return this.buildSourceChoices(resolved.demands, inputs);
  }

  private buildSourceChoices(demands: readonly FactDemandProjection[], inputs: readonly CreationDraftSourceChoiceInput[]): CreationDraftSourceChoice[] {
    const byDemandId = new Map(demands.map((demand) => [demand.demandId, demand]));
    return inputs.map((input) => {
      const demand = byDemandId.get(input.demandId);
      if (!demand) throw new BadRequestException(`Unknown source demand: ${input.demandId}`);
      const candidate = demand.candidateSources.find((source) => source.sourceId === input.sourceId);
      if (!candidate || !candidate.usable) throw new BadRequestException(`Source is not authorized, online or fresh: ${input.sourceId}`);
      const selection: SourceSelection = buildSourceSelection({
        kind: candidate.kind,
        sourceId: candidate.sourceId,
        connectionId: candidate.connectionId,
        capabilityKey: candidate.capabilityKey,
        trustedDeviceId: candidate.trustedDeviceId,
        deviceAppConnectionId: candidate.deviceAppConnectionId,
        truthRecordId: candidate.truthRecordId,
        truthVersionId: candidate.truthVersionId,
      });
      return { demandId: demand.demandId, factKey: demand.factKey, subjectKey: demand.subject.subjectKey, selection };
    });
  }

  private sourceChoicesUsable(choices: readonly CreationDraftSourceChoice[], demands: readonly FactDemandProjection[]): boolean {
    const byDemandId = new Map(demands.map((demand) => [demand.demandId, demand]));
    for (const choice of choices) {
      const demand = byDemandId.get(choice.demandId);
      if (!demand) return false;
      const candidate = demand.candidateSources.find((source) => source.sourceId === choice.selection.sourceId);
      if (!candidate || !candidate.usable) return false;
    }
    return true;
  }

  private async offerFresh(userId: string, selectedOfferKey: string, now: Date): Promise<boolean> {
    const rows = await this.db.select({
      offerKey: planOfferSnapshots.offerKey,
      status: planOfferSnapshots.status,
      expiresAt: planOfferSnapshots.expiresAt,
      createdAt: planOfferSnapshots.createdAt,
    }).from(planOfferSnapshots).where(eq(planOfferSnapshots.userId, userId));
    const latest = rows.filter((row) => row.offerKey === selectedOfferKey || row.offerKey.startsWith(`${selectedOfferKey}:`))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    return Boolean(latest && latest.status === 'AVAILABLE' && latest.expiresAt.getTime() > now.getTime());
  }

  private async findByKey(userId: string, scenarioKey: string) {
    return (await this.db.select().from(creationDrafts)
      .where(and(eq(creationDrafts.userId, userId), eq(creationDrafts.scopeKey, `scenario:${scenarioKey}`))).limit(1))[0];
  }

  private async findById(draftId: string) {
    return (await this.db.select().from(creationDrafts).where(eq(creationDrafts.draftId, draftId)).limit(1))[0];
  }

  private async findOwned(userId: string, draftId: string) {
    const row = (await this.db.select().from(creationDrafts)
      .where(and(eq(creationDrafts.draftId, draftId), eq(creationDrafts.userId, userId))).limit(1))[0];
    if (!row) throw new NotFoundException('CreationDraft not found');
    return row;
  }

  private toEntity(row: typeof creationDrafts.$inferSelect): CreationDraft {
    return {
      contractVersion: CREATION_DRAFT_CONTRACT_VERSION,
      draftId: row.draftId,
      conversationId: row.conversationId,
      proposalMessageId: row.proposalMessageId,
      scenarioKey: row.scenarioKey,
      scenarioRevision: row.scenarioRevision,
      stage: row.stage as CreationDraftStage,
      goal: row.goalJson as unknown as ScenarioGoalSpec,
      subject: (row.subjectJson ?? null) as ScenarioResourceSubject | null,
      sourceChoices: row.sourceChoicesJson as unknown as readonly CreationDraftSourceChoice[],
      selectedOfferKey: row.selectedOfferKey,
      version: row.version,
      state: row.state as CreationDraftState,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }
}
