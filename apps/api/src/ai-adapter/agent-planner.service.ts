import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PLAN_STRATEGIES,
  compileScenarioPlan,
  scenarioByKey,
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
  proposalId: string;
  result: AgentPlannerResultKind | 'PLANNER_OUTPUT_INVALID';
  proposal?: AgentPlanProposal;
  answer?: { explanation: string };
  clarification?: { missingRequirements: string[] };
  validationErrors: string[];
  warnings: string[];
}

export interface PlannerRuntimeFacts {
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
  ) {}

  async plan(userId: string, intent: string, options: { audit?: boolean } = {}): Promise<PlannerResult> {
    const facts = await this.collectFacts(userId, intent);
    return this.planWithFacts(intent, facts, { ...options, userId });
  }

  /** No-DB planning path used by deterministic unit tests (audit disabled). */
  async planWithFacts(intent: string, facts: PlannerRuntimeFacts, options: { audit?: boolean; userId?: string } = {}): Promise<PlannerResult> {
    const proposalId = newId();
    const skillBodies = this.skills.listRuntimeAgentSkills().map((skill) => ({ name: skill.name, instruction: skill.bodyMarkdown }));
    const context = this.compiler.compile({
      intent,
      domain: facts.domain,
      scenarios: facts.scenarios,
      truths: facts.truths,
      skills: skillBodies,
      capabilities: facts.capabilities,
      tools: facts.tools,
      evidence: [],
      untrustedSources: [],
    });
    const output = await this.model.complete({ intent, context, systemPolicy: '见 SYSTEM_POLICY section', allowedResults: [...AGENT_PLANNER_RESULTS] });
    const validation = this.validateOutput(output, facts, intent);

    const result: PlannerResult = {
      proposalId,
      result: validation.valid ? output.result : 'PLANNER_OUTPUT_INVALID',
      validationErrors: validation.errors,
      warnings: [...context.warnings, ...output.warnings],
    };
    if (validation.valid) {
      if (output.result === 'ANSWER') result.answer = { explanation: output.explanation };
      if (output.result === 'CLARIFICATION_REQUIRED') result.clarification = { missingRequirements: output.missingRequirements };
      if (output.result === 'PLAN_DRAFT') result.proposal = validation.proposal!;
    }

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
    const capabilities = (await this.readiness.projectCapabilities(userId)).map((capability) => ({
      key: capability.capabilityKey,
      usable: capability.usable,
      reasons: capability.reasons,
    }));
    const tools = this.mcp.listEnabledTools();
    return { domain, scenarios, truths, capabilities, tools };
  }

  /** Pure fail-closed validation of model output against collected runtime facts. */
  validateOutput(output: AgentModelOutput, facts: PlannerRuntimeFacts, intent: string): { valid: boolean; errors: string[]; proposal?: AgentPlanProposal } {
    const errors: string[] = [];
    if (!AGENT_PLANNER_RESULTS.includes(output.result)) {
      errors.push(`Model result ${output.result} is not allowed; only ${AGENT_PLANNER_RESULTS.join('/')}`);
    }
    for (const marker of FORBIDDEN_OUTPUT_MARKERS) {
      const serialized = JSON.stringify(output);
      if (serialized.includes(marker)) errors.push(`Model output contains forbidden action marker ${marker}`);
    }

    const capabilityKeys = new Set(facts.capabilities.map((capability) => capability.key));
    const toolKeys = new Set(facts.tools.filter((tool) => tool.enabled).map((tool) => `${tool.serverId}/${tool.toolName}`));
    const truthIds = new Set(facts.truths.map((truth) => truth.truthId));
    const knownCapabilityKeys = new Set(capabilityKeys);
    // Skills may only reference tools in the agent's trusted surface: the safe
    // Lazy Armor MCP tool set plus enabled external MCP bindings.
    const agentToolNames = new Set<string>([...toolKeys].map((key) => key.split('/')[1] ?? key));
    for (const tool of this.lazyArmorTools.listTools()) agentToolNames.add(tool.name);

    let compiled: CompiledScenarioPlan | null = null;
    if (output.result === 'PLAN_DRAFT') {
      const scenario = output.scenarioKey ? scenarioByKey(output.scenarioKey) : null;
      if (!scenario) errors.push(`Scenario ${output.scenarioKey} does not exist`);
      else {
        if (output.scenarioRevision !== null && output.scenarioRevision !== scenario.revision) errors.push(`Scenario revision ${output.scenarioRevision} does not match ${scenario.revision}`);
        const strategyValid = output.strategyKey !== null && PLAN_STRATEGIES.some((strategy) => strategy.key === output.strategyKey);
        if (!strategyValid) errors.push(`Strategy ${output.strategyKey} does not exist`);
        for (const capabilityKey of [...scenario.sourceRequirements, ...scenario.actionRequirements].map((requirement) => requirement.capabilityKey)) knownCapabilityKeys.add(capabilityKey);
        if (errors.length === 0 && output.strategyKey) {
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
      scenarioRevision: output.scenarioRevision,
      strategyKey: output.strategyKey,
      requiredFacts: output.requiredFacts,
      selectedTruthRefs: output.selectedTruthRefs,
      requiredCapabilities: output.requiredCapabilities,
      selectedSkillIds: output.selectedSkillIds,
      toolRequirements: output.toolRequirements,
      draftDefinition: compiled ? compiled.definition as unknown as Record<string, unknown> : null,
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
