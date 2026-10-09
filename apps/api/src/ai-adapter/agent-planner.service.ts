import { userEventInputSchema, userEventExternalSyncIntentSchema, type UserEventExternalSyncIntent, type UserEventInput } from '@lazy-armor/plan-schema';
import { GoalUnderstandingService } from '../agent/planner/goal-understanding.service';
import { GoalExecutionContextService, type GoalTimeContext } from '../agent/goal-execution-context.service';
import {LocalAcquisitionService} from '../consumer/local-acquisition.service';
import {ModuleRef} from '@nestjs/core';
import { notificationFactQuerySchema } from '../consumer/notification-fact-query.contract';
import {LocalCapabilitiesService} from '../consumer/local-capabilities.service';
import {compileScheduledCalendarAuthoring,compileNotificationWatchAuthoring,canonicalCapabilityId, type ScheduledCalendarAuthoring, type NotificationWatchAuthoring} from '@lazy-armor/plan-schema';
import type {AcquisitionCoverage} from '@lazy-armor/plan-schema';
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  PLAN_STRATEGIES,
  compileScenarioPlan,
  scenarioByKey,
  compileActionProposal,
  type CompiledScenarioPlan,
  type StrategyKey,
} from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { AgentContextCompiler, type AgentCapabilityRef, type AgentScenarioRef, type AgentToolRef, type CompiledTruthRef } from './agent-context-compiler.service';
import {
  AGENT_PLANNER_RESULTS,
  type AgentModelAdapter,
  type AgentModelOutput,
  type AgentPlannerResultKind,
} from './agent-model-adapter';
import type { SkillDescriptor } from '../portable-skills/skill-descriptor';
import { assertSkillReferencesAllowed } from '../portable-skills/skill-descriptor';
import { SkillRegistryService } from '../portable-skills/skill-registry.service';
import { AuditService } from '../audit/audit.service';
import { ReadinessEvidenceService } from '../runtime-catalog/readiness-evidence.service';
import { RuntimeCatalogRegistryService } from '../runtime-catalog/runtime-catalog-registry.service';
import { RealityPipelineService } from '../reality-pipeline/reality-pipeline.service';
import { McpServerRegistryService } from '../mcp/mcp-server-registry.service';
import { LazyArmorMcpToolService } from '../mcp/lazy-armor-mcp-tools';

export const AGENT_MODEL = Symbol('AGENT_MODEL');

export interface AgentPlanProposal {
  notificationWatch?: NotificationWatchAuthoring;
  scheduledCalendar?: ScheduledCalendarAuthoring;
  proposalId: string;
  intentSummary: string;
  domain: string | null;
  scenarioKey: string | null;
  scenarioRevision: number | null;
  strategyKey: string | null;
  requiredFacts: string[];
  selectedTruthRefs: string[];
  requiredCapabilities: string[];
  selectedSkillIds: string[];
  toolRequirements: Array<{ serverId: string; toolName: string; effectClass: string; requiresApproval: boolean }>;
  draftDefinition: Record<string, unknown> | null;
  explanation: string;
  missingRequirements: string[];
  warnings: string[];
  riskHints: string[];
}

export interface PlannerResult {
  memoryRefs?: Array<{ id: string; version: number; settingsVersion: number }>;
  understanding?: import('@lazy-armor/plan-schema').GoalUnderstanding;
  factQuery?: import('../consumer/notification-fact-query.contract').NotificationFactQuery;
  externalSync?: UserEventExternalSyncIntent | null;
  sourceTruthRefs?: string[];
  sourceTruthVersions?: Array<{truthId:string;versionId:string}>;
  userEvent?: UserEventInput;
  actionProposal?: import('@lazy-armor/plan-schema').ActionProposal;
  proposalId: string;
  result: AgentPlannerResultKind | 'PLANNER_OUTPUT_INVALID';
  proposal?: AgentPlanProposal;
  answer?: { explanation: string };
  clarification?: { missingRequirements: string[] };
  validationErrors: string[];
  warnings: string[];
}

export interface PlannerRuntimeFacts {
  memoryContext?: import('@lazy-armor/plan-schema').MemoryContextSnapshot;
  timeContext?: GoalTimeContext;
  acquisitionCoverage?:readonly AcquisitionCoverage[];
  domain: string | null;
  scenarios: AgentScenarioRef[];
  truths: CompiledTruthRef[];
  capabilities: AgentCapabilityRef[];
  tools: AgentToolRef[];
}

const FORBIDDEN_OUTPUT_MARKERS = ['EXECUTE', 'APPROVE', 'PAY', 'DELETE', 'PUBLISH', 'TRANSFER_MONEY', 'execute_now', 'approve_execution', 'pay', 'transfer', 'delete_resource', 'publish'];

@Injectable()
export class AgentPlannerService {
  private readonly logger = new Logger(AgentPlannerService.name);

  constructor(
    @Inject(AGENT_MODEL) private readonly model: AgentModelAdapter,
    private readonly compiler: AgentContextCompiler,
    private readonly skills: SkillRegistryService,
    private readonly catalog: RuntimeCatalogRegistryService,
    private readonly readiness: ReadinessEvidenceService,
    private readonly reality: RealityPipelineService,
    private readonly mcp: McpServerRegistryService,
    private readonly audit: AuditService,
    private readonly lazyArmorTools: LazyArmorMcpToolService,
    @Optional() private readonly acquisitions?:LocalAcquisitionService,
    @Optional() private readonly moduleRef?:ModuleRef,
    @Optional() private readonly understanding?: GoalUnderstandingService,
    @Optional() private readonly executionContext?: GoalExecutionContextService,
  ) {}

  async plan(userId: string, intent: string, options: { audit?: boolean; workContext?: 'TEMPORARY' | 'PLAN'; contextSources?: Array<{ label: string; content: string }> } = {}): Promise<PlannerResult> {
    const facts = await this.collectFacts(userId, intent);
    return this.planWithFacts(intent, facts, { ...options, userId });
  }

  /** No-DB planning path used by deterministic unit tests (audit disabled). */
  async planWithFacts(intent: string, facts: PlannerRuntimeFacts, options: { audit?: boolean; userId?: string; workContext?: 'TEMPORARY' | 'PLAN'; contextSources?: Array<{ label: string; content: string }> } = {}): Promise<PlannerResult> {
    const proposalId = newId();
    const skillBodies = this.skills.listRuntimeAgentSkills().map((skill) => ({ name: skill.name, instruction: skill.bodyMarkdown }));
    const context = this.compiler.compile({
      intent,
      timeContext: facts.timeContext,
      memoryContext: facts.memoryContext,
      acquisitionCoverage:facts.acquisitionCoverage,
      domain: facts.domain,
      scenarios: facts.scenarios,
      truths: facts.truths,
      skills: skillBodies,
      capabilities: facts.capabilities,
      tools: facts.tools,
      evidence: [],
      untrustedSources: options.contextSources ?? [],
    });
    const output = await this.model.complete({ userId: options.userId, workContext: options.workContext, intent, context, systemPolicy: '见 SYSTEM_POLICY section', allowedResults: [...AGENT_PLANNER_RESULTS] });
    const validation = this.validateOutput(output, facts, intent);
    if (facts.memoryContext?.items.length && (!options.userId || !this.executionContext ||
      !(await this.executionContext.memoryContextCurrent(options.userId, facts.memoryContext)))) {
      validation.valid = false;
      validation.errors.push('MEMORY_CONTEXT_CHANGED');
    }
    if (output.notificationWatch && options.workContext !== 'PLAN') { validation.valid = false; validation.errors.push('Persistent notification watch requires Plan context'); }
    if (output.result === 'ACTION_PROPOSAL' && options.workContext !== 'TEMPORARY') { validation.valid = false; validation.errors.push('ActionProposal requires temporary conversation context'); }

    const result: PlannerResult = {
      proposalId,
      result: validation.valid ? output.result : 'PLANNER_OUTPUT_INVALID',
      validationErrors: validation.errors,
      warnings: [...context.warnings, ...output.warnings],
    };
    if(validation.valid&&output.result==='PLAN_DRAFT'&&output.scenarioKey===null){
      result.result='CLARIFICATION_REQUIRED';
      result.clarification={missingRequirements:['请补充要安排的事项、日期时间及使用的日历，以确定计划场景。']};
    }
    if (validation.valid) {
      if (facts.memoryContext?.items.length) result.memoryRefs = facts.memoryContext.items.map(item => ({ id: item.id, version: item.version, settingsVersion: facts.memoryContext!.settingsVersion }));
      if (output.factQuery && output.result === 'ANSWER' && options.workContext === 'TEMPORARY') {
        result.factQuery = output.factQuery;
      }
      if (output.result === 'USER_EVENT_DRAFT') { result.userEvent = userEventInputSchema.parse(output.userEvent); result.sourceTruthRefs = output.selectedTruthRefs; result.sourceTruthVersions = facts.truths.filter(t=>output.selectedTruthRefs.includes(t.truthId) && t.truthVersionId).map(t=>({truthId:t.truthId,versionId:t.truthVersionId!})); result.externalSync = output.externalSync ? userEventExternalSyncIntentSchema.parse(output.externalSync) : null; result.answer = { explanation: output.explanation }; }
      if (output.result === 'ANSWER') result.answer = { explanation: output.explanation };
      if (output.result === 'CLARIFICATION_REQUIRED') result.clarification = { missingRequirements: output.missingRequirements };
      if (output.result === 'PLAN_DRAFT') result.proposal = { ...validation.proposal!, proposalId };
      if (output.result === 'ACTION_PROPOSAL') { result.actionProposal = compileActionProposal(output.actionProposal).proposal; result.answer = { explanation: output.explanation }; }
    }

    result.understanding = (this.understanding ?? new GoalUnderstandingService()).compile(result, output, facts, this.model.modelId());

    if (options.audit !== false && options.userId) {
      const modelId = this.model.modelId();
      const proposal = validation.proposal;
      try {
        await this.audit.append({
          actorType: 'user', actorUserId: options.userId, action: 'AGENT_PLANNER_RUN',
          resourceType: 'agent_planner_run', resourceId: proposalId, userId: options.userId,
          correlationId: proposalId, source: 'api',
          result: validation.valid ? 'success' : 'blocked',
          reasonCode: validation.valid ? null : 'PLANNER_OUTPUT_INVALID',
          changeSummary: `Agent planner ${intent.slice(0, 80)} -> ${result.result}`,
          after: {
            plannerRunId: proposalId,
            memoryRefs: result.memoryRefs ?? [],
            goalUnderstanding: result.understanding ? {
              schemaVersion: result.understanding.schemaVersion,
              lifecycle: result.understanding.lifecycle,
              executionMode: result.understanding.executionMode,
              policy: result.understanding.policy,
              generatedAt: result.understanding.provenance.generatedAt,
              capabilities: result.understanding.capabilities.map(({ key, availability }) => ({ key, availability })),
            } : null,
            scheduledCalendarParameters:output.scheduledCalendar??null,
            notificationWatchParameters:output.notificationWatch??null,
            userId: options.userId,
            modelProvider: modelId,
            modelName: modelId,
            intentHash: createHash('sha256').update(intent).digest('hex'),
            selectedScenario: proposal?.scenarioKey ?? output.scenarioKey ?? null,
            selectedStrategy: proposal?.strategyKey ?? output.strategyKey ?? null,
            truthRefs: proposal?.selectedTruthRefs ?? output.selectedTruthRefs ?? [],
            skillIds: proposal?.selectedSkillIds ?? output.selectedSkillIds ?? [],
            toolBindings: (proposal?.toolRequirements ?? output.toolRequirements ?? []).map((tool) => `${tool.serverId}/${tool.toolName}`),
            resultType: result.result,
            proposalId,
            validationErrors: validation.errors,
          },
        });
      } catch (error) {
        this.logger.warn(`Planner audit append failed: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
    return result;
  }

  async collectFacts(userId: string, intent: string): Promise<PlannerRuntimeFacts> {
    const memoryContext = this.executionContext ? await this.executionContext.memoryContext(userId, intent) : undefined;
    const timeContext = this.executionContext ? await this.executionContext.timeContext(userId) : undefined;
    const domain = this.compiler.inferDomain(intent);
    const top = this.compiler.topScenarios(domain, 6);
    const readinessByKey = new Map<string, string>();
    for (const scenario of top) {
      try {
        const projected = await this.readiness.projectScenarioRuntimeEvidence(userId, this.catalog.getScenario(scenario.key));
        readinessByKey.set(scenario.key, projected.readiness.state);
      } catch {
        readinessByKey.set(scenario.key, 'CATALOG_ONLY');
      }
    }
    const scenarios = top.map((scenario) => ({ ...scenario, readinessState: readinessByKey.get(scenario.key) ?? 'CATALOG_ONLY' }));
    const truths = await this.collectTruthRefs(userId);
    const capabilities:AgentCapabilityRef[] = (await this.readiness.projectCapabilities(userId)).map((capability) => ({
      key: capability.capabilityKey,
      connectionId: capability.connectionId,
      providerKey: capability.providerKey,
      operation: capability.operation,
      usable: capability.usable,
      reasons: capability.reasons,
    }));
    if(this.moduleRef){
      const native=await this.moduleRef.get(LocalCapabilitiesService,{strict:false}).project(userId);
      for(const row of native){const state=row.capabilityState;const key=state?canonicalCapabilityId(state.key):null;if(state&&key)capabilities.push({key,providerKey:'android-native',usable:state.availability==='AVAILABLE',reasons:row.reasons});}
    }
    const tools = this.mcp.listEnabledTools();
    if(this.moduleRef){
      const {PersistentNotificationPlanService}=await import('../consumer/persistent-notification-plan.service');
      for(const source of await this.moduleRef.get(PersistentNotificationPlanService,{strict:false}).sources(userId))capabilities.push({key:'app.notification.read',connectionId:source.connectionId,trustedDeviceId:source.trustedDeviceId,providerKey:source.sourcePackage,usable:false,reasons:['SOURCE_IDENTITY_ONLY']});
    }
    const coverage=this.acquisitions?await this.acquisitions.coverage(userId):null;
    const acquisitionCoverage:AcquisitionCoverage[]|undefined=coverage?.sources.map(round=>({sourceId:round.sourceId,factKey:round.capability,state:round.state as AcquisitionCoverage['state'],observedAt:round.observedAt?.toISOString()??null,evidenceRefs:round.evidenceRefsJson,reason:round.reason}));
    return { memoryContext, timeContext, domain, scenarios, truths, capabilities, tools, acquisitionCoverage:acquisitionCoverage?.length?acquisitionCoverage:undefined };
  }

  /** Pure fail-closed validation of model output against collected runtime facts. */
  validateOutput(output: AgentModelOutput, facts: PlannerRuntimeFacts, intent: string): { valid: boolean; errors: string[]; proposal?: AgentPlanProposal } {
    const errors: string[] = [];
    if(output.notificationWatch&&(output.result!=='PLAN_DRAFT'||output.scheduledCalendar||output.factQuery||output.userEvent||output.actionProposal||output.externalSync))errors.push('Notification watch is a persistent read-only Recipe parameter contract');
    if (output.factQuery && (!notificationFactQuerySchema.safeParse(output.factQuery).success || output.result !== 'ANSWER'
      || output.actionProposal || output.userEvent || output.draftDefinition || output.toolRequirements.length
      || output.requiredCapabilities.length || output.requiredFacts.length)) errors.push('Fact query must be a bounded read-only ANSWER requirement');
    if (!AGENT_PLANNER_RESULTS.includes(output.result)) {
      errors.push(`Model result ${output.result} is not allowed; only ${AGENT_PLANNER_RESULTS.join('/')}`);
    }
    for (const marker of (output.result === 'ACTION_PROPOSAL' ? ['execute_now', 'approve_execution', 'transfer_money'] : FORBIDDEN_OUTPUT_MARKERS)) {
      const serialized = JSON.stringify(output);
      if (serialized.includes(marker)) errors.push(`Model output contains forbidden action marker ${marker}`);
    }

    if (output.result === 'USER_EVENT_DRAFT') {
      const parsed = userEventInputSchema.safeParse(output.userEvent);
      if (!parsed.success) errors.push('Invalid internal personal-item time contract');
      else if (Date.parse(parsed.data.reminderAt) <= Date.now()) errors.push('Internal reminder must be scheduled in the future');
      if (output.scenarioKey !== null || output.scenarioRevision !== null || output.strategyKey !== null || output.domain !== null || output.draftDefinition !== null || output.actionProposal || output.scheduledCalendar || output.requiredFacts.length || output.requiredCapabilities.length || output.selectedSkillIds.length || output.toolRequirements.length) errors.push('Internal personal item cannot carry Plan or external execution authority');
      const knownTruths=new Set(facts.truths.map(t=>t.truthId));
      if (output.selectedTruthRefs.some(ref=>!knownTruths.has(ref) || !facts.truths.find(t=>t.truthId===ref)?.truthVersionId)) errors.push('Personal-item source must reference owned verified Truth supplied in context');
      const requestsSync = /(同时|同步|加入|加到|写入).{0,16}(手机日历|系统日历|Google|Outlook|飞书日历)/i.test(intent);
      if (requestsSync && !output.externalSync) errors.push('Explicit external sync cannot be silently omitted');
      if (output.externalSync) {
        if (!requestsSync || !userEventExternalSyncIntentSchema.safeParse(output.externalSync).success) errors.push('External sync requires explicit user intent and a supported proposal contract');
        if (/Google|Outlook|飞书日历/i.test(intent)) errors.push('Only explicit phone calendar synchronization is currently supported');
        const duration = intent.match(/(?:持续|时长|占用)\s*(\d+)\s*(分钟|小时)/);
        const explicitMinutes = duration ? Number(duration[1]) * (duration[2] === '小时' ? 60 : 1) : /(?:持续|时长|占用)\s*半小时/.test(intent) ? 30 : null;
        if (explicitMinutes === null || explicitMinutes !== output.externalSync.durationMinutes) errors.push('External calendar duration must match an explicit user-provided duration; clarify unsupported wording');
      }
      return { valid: errors.length === 0, errors };
    }
    if (output.externalSync) errors.push('External sync intent requires USER_EVENT_DRAFT');
    if (output.userEvent) errors.push('Internal personal-item parameters require USER_EVENT_DRAFT');
    const capabilityKeys = new Set(facts.capabilities.map((capability) => capability.key));
    const toolKeys = new Set(facts.tools.filter((tool) => tool.enabled).map((tool) => `${tool.serverId}/${tool.toolName}`));
    const truthIds = new Set(facts.truths.map((truth) => truth.truthId));
    const knownCapabilityKeys = new Set(capabilityKeys);
    // Skills may only reference tools in the agent's trusted surface: the safe
    // Lazy Armor MCP tool set plus enabled external MCP bindings.
    const agentToolNames = new Set<string>([...toolKeys].map((key) => key.split('/')[1] ?? key));
    for (const tool of this.lazyArmorTools.listTools()) agentToolNames.add(tool.name);

    let compiled: CompiledScenarioPlan | null = null;
    let calendar:ReturnType<typeof compileScheduledCalendarAuthoring>|null=null;
    let watch:ReturnType<typeof compileNotificationWatchAuthoring>|null=null;
    if (output.result === 'ACTION_PROPOSAL') {
      try {
        const action = compileActionProposal(output.actionProposal).proposal;
        if (action.requiredCapability && !capabilityKeys.has(action.requiredCapability)) errors.push('Unknown ActionProposal capability');
        if (output.toolRequirements.length) errors.push('ActionProposal tools must be bound by the canonical action adapter');
      } catch { errors.push('ActionProposal does not satisfy the canonical action contract'); }
    }
    if (output.result === 'PLAN_DRAFT') {
      if(!output.scheduledCalendar&&(output.requiredCapabilities.includes('calendar.event.create')||/(创建|添加|写入).*(日历|日程)|(日历|日程).*(创建|添加|写入)/.test(intent)))errors.push('Calendar creation requires the registered scheduled Calendar Recipe parameter contract');
      const scenario = output.scenarioKey ? scenarioByKey(output.scenarioKey) : null;
      if (!scenario) errors.push(`Scenario ${output.scenarioKey} does not exist`);
      else {
        if (output.scenarioRevision !== null && output.scenarioRevision !== scenario.revision) errors.push(`Scenario revision ${output.scenarioRevision} does not match ${scenario.revision}`);
        const strategyValid = output.strategyKey !== null && PLAN_STRATEGIES.some((strategy) => strategy.key === output.strategyKey);
        if (!strategyValid) errors.push(`Strategy ${output.strategyKey} does not exist`);
        for (const capabilityKey of [...scenario.sourceRequirements, ...scenario.actionRequirements].map((requirement) => requirement.capabilityKey)) knownCapabilityKeys.add(capabilityKey);
        if(output.scheduledCalendar){
          try {
            calendar=compileScheduledCalendarAuthoring(output.scenarioKey,output.scheduledCalendar,output.intentSummary);
            if(output.draftDefinition!==null||output.toolRequirements.length)throw new Error('Recipe parameters cannot include free-form actions or tools');
            if(output.strategyKey!==calendar.strategy)throw new Error('Recipe strategy mismatch');
            if(!facts.truths.some(t=>t.resourceType==='CalendarEvent'&&t.subjectKey===calendar!.subject.subjectKey&&t.subjectKey.split(':')[3]===calendar!.parameters.calendarEvent.calendarId))throw new Error('Calendar observation scope is not an owned discovered resource');
            for(const key of calendar.requiredCapabilities)knownCapabilityKeys.add(key);
          } catch(error){errors.push(error instanceof Error?error.message:'Calendar authoring contract invalid');}
        }
        if(output.notificationWatch){
          try{
            watch=compileNotificationWatchAuthoring(output.scenarioKey,output.notificationWatch,output.intentSummary);
            if(output.draftDefinition!==null||output.toolRequirements.length||output.selectedTruthRefs.length||output.selectedSkillIds.length||output.strategyKey!==watch.strategy)throw new Error('Notification watch requires only its controlled Recipe parameters');
            if(!facts.capabilities.some(c=>c.key==='app.notification.read'&&c.connectionId===watch!.parameters.connectionId&&c.trustedDeviceId===watch!.parameters.trustedDeviceId&&c.providerKey===watch!.parameters.sourcePackage))throw new Error('Notification source is not an owned discovered source');
            for(const key of watch.requiredCapabilities)knownCapabilityKeys.add(key);
          }catch(error){errors.push(error instanceof Error?error.message:'Notification watch authoring contract invalid');}
        }
        if (errors.length === 0 && output.strategyKey && !calendar && !watch) {
          try {
            compiled = compileScenarioPlan({ scenarioKey: scenario.key, scenarioRevision: scenario.revision, strategy: output.strategyKey as StrategyKey, name: output.intentSummary || scenario.label, mode: 'DRAFT' });
          } catch (error) {
            errors.push(`Draft compilation failed: ${error instanceof Error ? error.message : 'unknown'}`);
          }
        }
      }
    }

    for (const truthId of output.selectedTruthRefs) {
      if (!truthIds.has(truthId)) errors.push(`Selected Truth ref ${truthId} does not exist or is stale`);
    }
    for (const capability of output.requiredCapabilities) {
      if (!knownCapabilityKeys.has(capability)) errors.push(`Required capability ${capability} does not exist`);
    }
    for (const tool of output.toolRequirements) {
      const key = `${tool.serverId}/${tool.toolName}`;
      if (!toolKeys.has(key)) errors.push(`Tool requirement ${key} is not a valid enabled binding`);
      else if (tool.effectClass !== 'READ_ONLY') {
        errors.push(`Tool requirement ${key} is a side-effect tool and cannot be invoked directly by the planner`);
      }
    }
    for (const skillId of output.selectedSkillIds) {
      const skill = this.skills.get(skillId);
      if (!skill) { errors.push(`Selected skill ${skillId} does not exist`); continue; }
      errors.push(...assertSkillReferencesAllowed(skill, capabilityKeys, agentToolNames));
    }

    if (output.result === 'ANSWER' && !output.explanation.trim()) errors.push('ANSWER requires an explanation');
    if (output.result === 'CLARIFICATION_REQUIRED' && output.missingRequirements.length === 0) errors.push('CLARIFICATION_REQUIRED requires missingRequirements');

    if (errors.length) return { valid: false, errors };

    const proposal: AgentPlanProposal = {
      proposalId: createHash('sha256').update(`${intent}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 32),
      intentSummary: output.intentSummary,
      domain: output.domain,
      scenarioKey: output.scenarioKey,
      scenarioRevision: watch?watch.scenarioRevision:calendar?calendar.scenarioRevision:output.scenarioRevision,
      strategyKey: output.strategyKey,
      requiredFacts: watch?watch.requiredFacts:calendar?[...calendar.requiredFacts]:output.requiredFacts,
      selectedTruthRefs: output.selectedTruthRefs,
      requiredCapabilities: watch?watch.requiredCapabilities:calendar?calendar.requiredCapabilities:output.requiredCapabilities,
      selectedSkillIds: output.selectedSkillIds,
      toolRequirements: output.toolRequirements,
      draftDefinition: watch?watch.definition as unknown as Record<string,unknown>:calendar?calendar.definition as unknown as Record<string,unknown>:compiled ? compiled.definition as unknown as Record<string, unknown> : null,
      ...(watch?{notificationWatch:watch.parameters}:{}),
      ...(calendar?{scheduledCalendar:calendar.parameters}:{}),
      explanation: output.explanation,
      missingRequirements: output.missingRequirements,
      warnings: output.warnings,
      riskHints: output.riskHints,
    };
    return { valid: true, errors: [], proposal };
  }

  private async collectTruthRefs(userId: string): Promise<CompiledTruthRef[]> {
    const truths = await this.reality.listTruth(userId);
    return truths.slice(0, 40).map((truth) => {
      const value = (truth.currentVersion?.value ?? {}) as Record<string, unknown>;
      const provenance = Array.isArray(truth.provenance) ? truth.provenance[0] as Record<string, unknown> | undefined : undefined;
      return {
        subjectKey:typeof value.subjectKey==='string'?value.subjectKey:undefined,
        resourceType:typeof value.resourceType==='string'?value.resourceType:undefined,
        truthId: truth.id,
        truthVersionId: typeof truth.currentVersionId === 'string' ? truth.currentVersionId : null,
        factKey: typeof value.factKey === 'string' ? value.factKey : String(truth.resourceKey),
        observedAt: typeof provenance?.observedAt === 'string' ? provenance.observedAt : (typeof value.observedAt === 'string' ? value.observedAt : null),
        sourceType: typeof provenance?.sourceMode === 'string' ? provenance.sourceMode : null,
        resourceId: typeof truth.resourceKey === 'string' ? truth.resourceKey : null,
        confidence: typeof value.confidence === 'number' ? value.confidence : null,
        verifiedAt: truth.verifiedAt,
      };
    });
  }
}

export type { SkillDescriptor };
