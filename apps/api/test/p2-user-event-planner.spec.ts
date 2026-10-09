import { describe, expect, it } from 'vitest';
import { AgentPlannerService } from '../src/ai-adapter/agent-planner.service';
import { FakeAgentModel, type AgentModelOutput } from '../src/ai-adapter/agent-model-adapter';
import { AgentContextCompiler } from '../src/ai-adapter/agent-context-compiler.service';
import { SkillRegistryService } from '../src/portable-skills/skill-registry.service';
const planner = new AgentPlannerService(new FakeAgentModel(), new AgentContextCompiler(), new SkillRegistryService(), {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
const facts = { domain: null, scenarios: [], truths: [], capabilities: [], tools: [] };
const output: AgentModelOutput = { result:'USER_EVENT_DRAFT',userEvent:{title:'去医院',dueAt:'2030-10-08T15:00:00+08:00',reminderAt:'2030-10-08T15:00:00+08:00',timezone:'Asia/Shanghai'},intentSummary:'去医院',explanation:'确认后创建内部提醒',domain:null,scenarioKey:null,scenarioRevision:null,strategyKey:null,requiredFacts:[],selectedTruthRefs:[],requiredCapabilities:[],selectedSkillIds:[],toolRequirements:[],draftDefinition:null,missingRequirements:[],warnings:[],riskHints:[] };
describe('Planner internal personal-item projection',()=>{
  it('accepts a user-confirmable personal item without Scenario, Truth or external resources',()=>{expect(planner.validateOutput(output,facts,'明天下午3点提醒我去医院')).toMatchObject({valid:true,errors:[]});});
  it.each([{requiredCapabilities:['calendar.event.create']},{scheduledCalendar:{recipeKey:'calendar.scheduled-create.v1'}},{scenarioKey:'work.calendar'},{draftDefinition:{actions:[]}}, {userEvent:{...output.userEvent,reminderAt:'2020-10-08T15:00:00+08:00'}}])('fails closed on authority or invalid time %j',patch=>{expect(planner.validateOutput({...output,...patch} as AgentModelOutput,facts,'一次性内部提醒').valid).toBe(false);});
  it('never silently drops an explicit external-sync request',()=>{expect(planner.validateOutput(output,facts,'明天下午3点提醒我去医院，同时加到手机日历').valid).toBe(false);});
  it('accepts explicit sync as proposal only, with the user-specified duration',()=>{
    const proposed={...output,externalSync:{kind:'EXTERNAL_CALENDAR_SYNC',policy:'CONFIRM_CHANGES',destination:'PHONE_CALENDAR',durationMinutes:30}} as AgentModelOutput;
    expect(planner.validateOutput(proposed,facts,'明天下午3点提醒我去医院，同时加到手机日历，持续30分钟').valid).toBe(true);
    expect(planner.validateOutput(proposed,facts,'明天下午3点提醒我去医院，同时加到手机日历').valid).toBe(false);
    expect(planner.validateOutput(proposed,facts,'明天下午3点提醒我去医院，同时加到手机日历，持续60分钟').valid).toBe(false);
    expect(planner.validateOutput(proposed,facts,'明天下午3点提醒我去医院，持续30分钟').valid).toBe(false);
  });
  it('rejects unowned source Truth before it can become a personal-item proposal',()=>{
    expect(planner.validateOutput({...output,selectedTruthRefs:['11111111-1111-4111-8111-111111111111']},facts,'去医院').valid).toBe(false);
  });
});
