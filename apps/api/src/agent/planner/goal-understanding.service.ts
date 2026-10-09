import { Injectable } from '@nestjs/common';
import { canonicalCapabilityId, goalUnderstandingSchema, type GoalUnderstanding } from '@lazy-armor/plan-schema';
import type { PlannerResult, PlannerRuntimeFacts } from '../../ai-adapter/agent-planner.service';
import type { AgentModelOutput } from '../../ai-adapter/agent-model-adapter';
import { goalLifecycle } from '../intent/goal-lifecycle';
import { proposalPolicy } from '../policy/proposal-policy';
import { normalizeGoalTimeContext } from '../goal-execution-context.service';

@Injectable()
export class GoalUnderstandingService {
  compile(result: PlannerResult, output: AgentModelOutput, facts: PlannerRuntimeFacts, modelId: string): GoalUnderstanding | undefined {
    // Malformed output never gets a reassuring interpretation or a confirmation surface.
    if (result.result === 'PLANNER_OUTPUT_INVALID' || result.validationErrors.length) return undefined;
    const lifecycle = goalLifecycle(result);
    const definition = result.proposal?.draftDefinition as { actions?: Array<{ requiredCapability?: string }> } | undefined;
    const keys = new Set([
      ...(result.proposal?.requiredCapabilities ?? output.requiredCapabilities),
      ...(definition?.actions ?? []).flatMap(action => action.requiredCapability ? [action.requiredCapability] : []),
      ...(result.actionProposal?.requiredCapability ? [result.actionProposal.requiredCapability] : []),
      ...(result.factQuery || result.proposal?.notificationWatch ? ['app.notification.read'] : []),
      ...(result.externalSync ? ['calendar.event.create'] : []),
    ].map(key => canonicalCapabilityId(key) ?? key));
    const sourcePackage = result.factQuery?.sourcePackage ?? result.proposal?.notificationWatch?.sourcePackage;
    const capabilities = [...keys].map(key => {
      const scoped = key === 'app.notification.read' && Boolean(sourcePackage);
      const matching = facts.capabilities.filter(row => (canonicalCapabilityId(row.key) ?? row.key) === key
        && (!scoped || row.providerKey === sourcePackage));
      // Source identity is evidence of ownership only, not of permission/health.
      const checked = matching.filter(row => !row.reasons.includes('SOURCE_IDENTITY_ONLY'));
      const available = checked.some(row => row.usable);
      return {
        key,
        availability: available ? 'AVAILABLE' as const : checked.length ? 'UNAVAILABLE' as const : 'UNRESOLVED' as const,
        reasons: available ? [] : [...new Set(checked.flatMap(row => row.reasons))],
        ...(scoped ? { sourcePackage } : {}),
      };
    });
    const policy = proposalPolicy(result);
    const steps: GoalUnderstanding['steps'] = [];
    if (policy.confirmationRequired) steps.push('CONFIRM');
    if (lifecycle === 'USER_EVENT') steps.push('SAVE_EVENT');
    if (lifecycle === 'PERSISTENT' || result.factQuery) steps.push('ACQUIRE', 'ASSESS');
    if (lifecycle === 'PERSISTENT' || result.actionProposal || result.externalSync) steps.push('EXECUTE', 'VERIFY');
    if (lifecycle === 'PERSISTENT' || lifecycle === 'USER_EVENT') steps.push('WAIT');
    const timeContext = facts.timeContext ?? normalizeGoalTimeContext();
    return goalUnderstandingSchema.parse({
      schemaVersion: 'goal-understanding.v1', proposalId: result.proposalId, stage: 'AI_PROPOSED',
      summary: (result.userEvent?.title ?? result.actionProposal?.name ?? result.proposal?.intentSummary ?? output.intentSummary).trim() || '请核对你的目标',
      domain: result.proposal?.domain ?? output.domain,
      lifecycle,
      executionMode: lifecycle === null ? null : lifecycle === 'PERSISTENT' || result.externalSync || result.factQuery ? 'COMPOSED' : 'DIRECT',
      requiredFacts: result.factQuery ? [result.factQuery.factKey] : result.proposal?.requiredFacts ?? output.requiredFacts,
      capabilities, steps,
      missingRequirements: result.clarification?.missingRequirements ?? result.proposal?.missingRequirements ?? output.missingRequirements,
      selectedSkillIds: result.proposal?.selectedSkillIds ?? output.selectedSkillIds,
      truthRefs: facts.truths.filter(truth => output.selectedTruthRefs.includes(truth.truthId))
        .map(truth => ({ truthId: truth.truthId, versionId: truth.truthVersionId })),
      policy, provenance: { modelId, generatedAt: new Date().toISOString(), timezone: timeContext.timezone, locale: timeContext.locale },
    });
  }
}
