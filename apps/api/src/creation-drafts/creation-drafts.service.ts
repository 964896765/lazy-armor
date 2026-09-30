import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { creationDrafts, planOfferSnapshots } from '@lazy-armor/database';
import {
  CREATION_DRAFT_CONTRACT_VERSION,
  assessPlanAvailability,
  buildSourceSelection,
  creationDraftInputSchema,
  scenarioContractV2ByKey,
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
import type { SaveCreationDraftDto } from './dto';

const CREATION_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class CreationDraftsService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly factDemands: FactDemandResolverService,
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
      reasonCodes.push('SCENARIO_CONTRACT_CHANGED');
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
            scenarioRevision: draft.scenarioRevision, goal, subject });
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
      .where(and(eq(creationDrafts.userId, userId), eq(creationDrafts.scenarioKey, scenarioKey))).limit(1))[0];
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
