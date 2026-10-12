import { Injectable } from '@nestjs/common';
import { newId } from '@lazy-armor/shared';
import { compositionAuthoringSnapshotSchema, type CompositionAuthoringSnapshot, type GoalBrief } from '@lazy-armor/plan-schema';
import { AgentPlannerService, type PlannerResult } from '../ai-adapter/agent-planner.service';
import { RequirementsService } from '../requirements/requirements.service';

type PlanningOptions = NonNullable<Parameters<AgentPlannerService['plan']>[2]> & { composition?: CompositionAuthoringSnapshot };
type RequirementInput = Parameters<RequirementsService['compile']>[0];

/** Coordinates validated authoring. It cannot grant permissions or dispatch actions. */
@Injectable()
export class OrchestratorService {
  constructor(private readonly requirements: RequirementsService, private readonly planner: AgentPlannerService) {}

  analyze(input: RequirementInput): GoalBrief {
    return this.requirements.compile(input);
  }

  async propose(userId: string, input: RequirementInput, options: PlanningOptions = {}): Promise<{ brief: GoalBrief; result: PlannerResult }> {
    const { composition: rawComposition, ...plannerOptions } = options;
    const composition = rawComposition ? compositionAuthoringSnapshotSchema.parse(rawComposition) : undefined;
    const brief = this.analyze(input);
    if (brief.readiness.state === 'NEEDS_CLARIFICATION') {
      return { brief, result: { proposalId: newId(), result: 'CLARIFICATION_REQUIRED',
        clarification: { missingRequirements: brief.readiness.questions.map(question => question.question) }, validationErrors: [], warnings: [] } };
    }
    // Keep earlier declared conditions available even after the bounded message history rolls over.
    // This is data in the original compiler's untrusted section, never runtime facts or permission.
    const requirementContext = {
      provenance: 'USER_REQUIREMENT_CONTEXT', goalBriefRef: this.requirements.reference(brief), executionAuthorized: false,
      fields: brief.fields.map(field => ({ key: field.key, status: field.status,
        value: field.value?.slice(0, 1000) ?? null, truncated: Boolean(field.value && field.value.length > 1000),
        sourceRefs: field.sourceRefs.slice(0, 3).map(source => ({ ...source, quote: source.quote.slice(0, 300), truncated: source.quote.length > 300 })),
      })),
    };
    const result = await this.planner.plan(userId, input.intent, { ...plannerOptions,
      ...(composition ? { methodRefs: composition.orderedMethodIds.map(id => composition.selection.basis.methodRefs.find(ref => ref.entryId === id)!) } : {}),
      contextSources: [...(plannerOptions.contextSources ?? []), { label: 'goal_requirements', content: JSON.stringify(requirementContext) },
        ...(composition ? [{ label: 'reviewed_method_composition', content: JSON.stringify({
          provenance: 'USER_REVIEWED_PLANNING_INPUT', executionAuthorized: false, runtimeRecipe: 'NOT_COMPILED',
          selectionHash: composition.selectionHash, sourceGoalBriefRef: composition.selection.basis.goalBriefRef,
          orderedMethodIds: composition.orderedMethodIds, inputLinks: composition.selection.graph.links,
          goalBindings: composition.selection.graph.goalBindings, deliveries: composition.selection.graph.deliveries,
          riskFloor: composition.riskFloor, verification: 'Original Plan validation, approval and Verification remain required. Method output values have not been generated or verified.',
        }) }] : [])],
    });
    return { result, brief: this.analyze({ ...input, understanding: result.understanding }) };
  }
}
