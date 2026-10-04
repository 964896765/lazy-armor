import { z } from 'zod';
import { ACTION_DEFINITIONS, ACTION_TYPES, PLAN_DOMAINS, normalizePlanDefinition, type PlanDefinitionInput } from './index';

/** Proposed data only. The server owns scheduling, approval policy and execution. */
export const actionProposalSchema = z.object({
  name: z.string().trim().min(1).max(120),
  domain: z.enum(PLAN_DOMAINS),
  actionType: z.enum(ACTION_TYPES),
  config: z.record(z.string(), z.unknown()),
  requiredCapability: z.string().min(1).max(100).optional(),
  connectionId: z.uuid().optional(),
  input: z.record(z.string(), z.unknown()),
}).strict();
export type ActionProposal = z.infer<typeof actionProposalSchema>;

export function compileActionProposal(raw: unknown) {
  const proposal = actionProposalSchema.parse(raw);
  if (!proposal.connectionId && (proposal.actionType !== 'notify' || proposal.config.channel !== 'in_app')) throw new Error('This local action has no verified one-time execution binding');
  if (!proposal.connectionId) {
    if (proposal.requiredCapability) throw new Error('Local notification capability binding is owned by the server; omit requiredCapability');
    proposal.input = z.object({ title: z.string().min(1).max(60).optional(), message: z.string().min(1).max(1000) }).strict().parse(proposal.input);
  } else if (Object.keys(proposal.input).some(key => /^(planId|executionId|userId|requestId|notification|shouldNotify|approval|risk)/i.test(key))) throw new Error('Proposal input contains server-owned runtime fields');
  if (ACTION_DEFINITIONS[proposal.actionType].externalEffect && (!proposal.requiredCapability || !proposal.connectionId)) {
    throw new Error('External action requires an explicit capability and owned connection');
  }
  const definition = normalizePlanDefinition({
    name: proposal.name, domain: proposal.domain, automationLevel: 'L1',
    approvalPolicy: { type: 'always', config: {} },
    sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
    triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
    conditions: [],
    actions: [{ actionType: proposal.actionType, config: proposal.config,
      ...(proposal.requiredCapability ? { requiredCapability: proposal.requiredCapability } : {}),
      ...(proposal.connectionId ? { connectionId: proposal.connectionId } : {}), stepOrder: 0 }],
  } as PlanDefinitionInput);
  return { proposal, definition };
}
