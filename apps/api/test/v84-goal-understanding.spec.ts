import { describe, expect, it } from 'vitest';
import { AgentPlannerService, type PlannerRuntimeFacts } from '../src/ai-adapter/agent-planner.service';
import { AgentContextCompiler } from '../src/ai-adapter/agent-context-compiler.service';
import { FakeAgentModel, FixtureAgentModel, type AgentModelOutput } from '../src/ai-adapter/agent-model-adapter';
import { SkillRegistryService } from '../src/portable-skills/skill-registry.service';
import { GoalUnderstandingService } from '../src/agent/planner/goal-understanding.service';

const facts: PlannerRuntimeFacts = { domain: null, scenarios: [], truths: [], capabilities: [], tools: [] };
const event: AgentModelOutput = {
  result: 'USER_EVENT_DRAFT', userEvent: { title: '去医院', dueAt: '2030-10-08T15:00:00+08:00', reminderAt: '2030-10-08T15:00:00+08:00', timezone: 'Asia/Shanghai' },
  intentSummary: '去医院', explanation: '确认后保存内部提醒', domain: null, scenarioKey: null, scenarioRevision: null, strategyKey: null,
  requiredFacts: [], selectedTruthRefs: [], requiredCapabilities: [], selectedSkillIds: [], toolRequirements: [], draftDefinition: null,
  missingRequirements: [], warnings: [], riskHints: [],
};
function planner(output?: AgentModelOutput) {
  const model = output ? { ...new FakeAgentModel(), modelId: () => 'unit-model', complete: async () => output } : new FixtureAgentModel();
  return new AgentPlannerService(model as never, new AgentContextCompiler(), new SkillRegistryService(), {} as never, {} as never, {} as never, {} as never, {} as never, { listTools: () => ['get_today', 'list_plans', 'get_plan', 'list_truth', 'get_truth', 'list_connections', 'get_connection_readiness', 'list_capabilities', 'get_capability', 'list_scenarios', 'get_scenario', 'create_plan_draft', 'explain_readiness'].map(name => ({ name })) } as never);
}
describe('V84 validated goal understanding', () => {
  it('preserves a personal reminder with no Plan or implicit Calendar requirements', async () => {
    const result = await planner(event).planWithFacts('明天下午3点提醒我去医院', facts, { audit: false, workContext: 'TEMPORARY' });
    expect(result.understanding).toMatchObject({ lifecycle: 'USER_EVENT', executionMode: 'DIRECT', capabilities: [], steps: ['CONFIRM', 'SAVE_EVENT', 'WAIT'], policy: { confirmationRequired: true, executionAuthorized: false, approval: 'NOT_APPLICABLE' } });
    expect(result.proposal).toBeUndefined();
    expect(result.understanding?.provenance.modelId).toBe('unit-model');
  });
  it('shows explicit sync as a proposal requiring independent Runtime policy', async () => {
    const output = { ...event, externalSync: { kind: 'EXTERNAL_CALENDAR_SYNC', policy: 'CONFIRM_CHANGES', destination: 'PHONE_CALENDAR', durationMinutes: 30 } } as AgentModelOutput;
    const result = await planner(output).planWithFacts('明天下午3点提醒我去医院，同时加到手机日历，持续30分钟', facts, { audit: false });
    expect(result.understanding).toMatchObject({ lifecycle: 'USER_EVENT', capabilities: [{ key: 'calendar.event.create', availability: 'UNRESOLVED' }], policy: { executionAuthorized: false, approval: 'RUNTIME_POLICY' } });
  });
  it('invalid model authority never produces an understanding card', async () => {
    const result = await planner({ ...event, requiredCapabilities: ['calendar.event.create'] }).planWithFacts('内部提醒', facts, { audit: false });
    expect(result.result).toBe('PLANNER_OUTPUT_INVALID');
    expect(result.understanding).toBeUndefined();
  });
  it('retains a Persistent lifecycle and one proposal identity for the compiled draft', async () => {
    const result = await planner().planWithFacts('每天帮我总结重要事项', facts, { audit: false, workContext: 'PLAN' });
    expect(result.result).toBe('PLAN_DRAFT');
    expect(result.understanding?.lifecycle).toBe('PERSISTENT');
    expect(result.understanding?.policy.executionAuthorized).toBe(false);
    expect(result.proposal?.proposalId).toBe(result.proposalId);
    expect(result.understanding?.proposalId).toBe(result.proposalId);
  });
  it('does not invent a lifecycle when the model asks for clarification', async () => {
    const output = { ...event, result: 'CLARIFICATION_REQUIRED', userEvent: null, missingRequirements: ['请补充事项时间'] } as AgentModelOutput;
    const result = await planner(output).planWithFacts('提醒一下', facts, { audit: false });
    expect(result.understanding).toMatchObject({ lifecycle: null, executionMode: null, steps: [], missingRequirements: ['请补充事项时间'], policy: { confirmationRequired: false, executionAuthorized: false } });
  });
  it('source identity and a different available source cannot make the requested source available', () => {
    const output = { ...event, result: 'ANSWER', userEvent: null, factQuery: { factKey: 'shipment.status', sourcePackage: 'com.jingdong.app.mall', lookbackHours: 24 } } as AgentModelOutput;
    const result = { proposalId: 'read', result: 'ANSWER' as const, factQuery: output.factQuery!, validationErrors: [], warnings: [] };
    const view = new GoalUnderstandingService().compile(result, output, { ...facts, capabilities: [
      { key: 'app.notification.read', usable: false, reasons: ['SOURCE_IDENTITY_ONLY'], providerKey: 'com.jingdong.app.mall' },
      { key: 'app.notification.read', usable: true, reasons: [], providerKey: 'com.other.app' },
    ] }, 'unit-model');
    expect(view?.capabilities).toEqual([{ key: 'app.notification.read', availability: 'UNRESOLVED', reasons: [], sourcePackage: 'com.jingdong.app.mall' }]);
  });
  it('compiled action requirements survive incomplete model capability hints', () => {
    const view = new GoalUnderstandingService().compile({ proposalId: 'compiled', result: 'PLAN_DRAFT', proposal: { requiredCapabilities: [], draftDefinition: { actions: [{ requiredCapability: 'calendar.event.update' }] } } as never, validationErrors: [], warnings: [] }, event, { ...facts, capabilities: [{ key: 'calendar.event.update', usable: false, reasons: ['PERMISSION_DENIED'] }] }, 'unit-model');
    expect(view?.capabilities).toEqual([{ key: 'calendar.event.update', availability: 'UNAVAILABLE', reasons: ['PERMISSION_DENIED'] }]);
  });
});
