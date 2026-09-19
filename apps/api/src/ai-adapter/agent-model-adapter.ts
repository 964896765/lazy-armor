import { Injectable } from '@nestjs/common';
import type { CompiledAgentContext } from './agent-context-compiler.service';

/**
 * Agent Model Adapter. Continues the existing AI Adapter boundary; there is no
 * MultiModelEngine / ModelGateway / LLMRouter here. The adapter only exposes
 * structured completion plus model capability metadata.
 */

export const AGENT_PLANNER_RESULTS = ['ANSWER', 'PLAN_DRAFT', 'CLARIFICATION_REQUIRED'] as const;
export type AgentPlannerResultKind = typeof AGENT_PLANNER_RESULTS[number];

export interface AgentToolRequirement {
  serverId: string;
  toolName: string;
  effectClass: 'READ_ONLY' | 'LOCAL_MUTATION' | 'EXTERNAL_SIDE_EFFECT';
  requiresApproval: boolean;
}

export interface AgentModelRequest {
  intent: string;
  context: CompiledAgentContext;
  /** Hard system policy, always separated from every other section. */
  systemPolicy: string;
  allowedResults: AgentPlannerResultKind[];
}

export interface AgentModelOutput {
  result: AgentPlannerResultKind;
  intentSummary: string;
  domain: string | null;
  scenarioKey: string | null;
  scenarioRevision: number | null;
  strategyKey: string | null;
  requiredFacts: string[];
  selectedTruthRefs: string[];
  requiredCapabilities: string[];
  selectedSkillIds: string[];
  toolRequirements: AgentToolRequirement[];
  /** Raw structured definition proposed by the model; the planner re-compiles it. */
  draftDefinition: Record<string, unknown> | null;
  explanation: string;
  missingRequirements: string[];
  warnings: string[];
  riskHints: string[];
}

export interface AgentModelCapability {
  modelId: string;
  supportsStructuredCompletion: boolean;
  supportsToolSelection: boolean;
  maxContextTokens: number;
}

export interface AgentModelAdapter {
  modelId(): string;
  capability(): AgentModelCapability;
  complete(request: AgentModelRequest): Promise<AgentModelOutput>;
}

/** Deterministic model that only ever produces a fixed ANSWER; used for tests. */
@Injectable()
export class FakeAgentModel implements AgentModelAdapter {
  private readonly answer = '这是固定回答。';

  modelId() { return 'fake-agent-model'; }
  capability(): AgentModelCapability {
    return { modelId: this.modelId(), supportsStructuredCompletion: true, supportsToolSelection: false, maxContextTokens: 4096 };
  }
  async complete(request: AgentModelRequest): Promise<AgentModelOutput> {
    return {
      result: 'ANSWER',
      intentSummary: request.intent,
      domain: null,
      scenarioKey: null,
      scenarioRevision: null,
      strategyKey: null,
      requiredFacts: [],
      selectedTruthRefs: [],
      requiredCapabilities: [],
      selectedSkillIds: [],
      toolRequirements: [],
      draftDefinition: null,
      explanation: this.answer,
      missingRequirements: [],
      warnings: [],
      riskHints: [],
    };
  }
}

const CONSUMABLE_KEYWORDS = ['耗材', '滤芯', '净水器', '更换提醒'];
const DELIVERY_KEYWORDS = ['快递', '物流', '运单', '签收', '没动静'];
const SUMMARY_KEYWORDS = ['每天', '摘要', '总结', '汇总', '重要事项'];

interface FixtureRule {
  match: (intent: string) => boolean;
  produce: (intent: string, request: AgentModelRequest) => AgentModelOutput;
}

/**
 * Deterministic fixture model covering the R7 Golden Journeys. It reads only
 * the USER_INTENT section and trusted runtime metadata; it never executes and
 * never treats untrusted source content as instructions.
 */
@Injectable()
export class FixtureAgentModel implements AgentModelAdapter {
  private readonly rules: FixtureRule[] = [
    {
      match: (intent) => SUMMARY_KEYWORDS.some((keyword) => intent.includes(keyword)) && intent.includes('每天'),
      produce: (intent) => this.planDraft('work.work_summary', 'PERIODIC_SUMMARY', intent, '每日重要事项摘要'),
    },
    {
      match: (intent) => DELIVERY_KEYWORDS.some((keyword) => intent.includes(keyword)) && /没有工作|没工作|没动静|不管用|不工作|怎么不/.test(intent),
      produce: (intent) => ({
        result: 'ANSWER',
        intentSummary: intent,
        domain: 'daily_life',
        scenarioKey: 'daily_life.delivery',
        scenarioRevision: 1,
        strategyKey: 'SILENT_FOLLOW_UP',
        requiredFacts: ['shipment.status'],
        selectedTruthRefs: [],
        requiredCapabilities: [],
        selectedSkillIds: ['READINESS_EXPLAINER'],
        toolRequirements: [],
        draftDefinition: null,
        explanation: '快递管家没有工作的原因是缺少可用的发货状态事实或连接尚未就绪，请先确认物流连接与授权。',
        missingRequirements: [],
        warnings: [],
        riskHints: [],
      }),
    },
    {
      match: (intent) => CONSUMABLE_KEYWORDS.some((keyword) => intent.includes(keyword)),
      produce: (intent, request) => {
        const truth = request.context.truths.find((item) => item.factKey === 'device.consumable.remaining_days');
        return this.planDraft('device.consumables', 'PREDICTIVE_PREPARE', intent, '设备耗材提醒', {
          requiredFacts: ['device.consumable.remaining_days'],
          selectedTruthRefs: truth ? [truth.truthId] : [],
        });
      },
    },
  ];

  modelId() { return 'fixture-agent-model'; }
  capability(): AgentModelCapability {
    return { modelId: this.modelId(), supportsStructuredCompletion: true, supportsToolSelection: true, maxContextTokens: 8192 };
  }

  async complete(request: AgentModelRequest): Promise<AgentModelOutput> {
    const rule = this.rules.find((candidate) => candidate.match(request.intent));
    if (rule) return rule.produce(request.intent, request);
    return {
      result: 'CLARIFICATION_REQUIRED',
      intentSummary: request.intent,
      domain: null,
      scenarioKey: null,
      scenarioRevision: null,
      strategyKey: null,
      requiredFacts: [],
      selectedTruthRefs: [],
      requiredCapabilities: [],
      selectedSkillIds: [],
      toolRequirements: [],
      draftDefinition: null,
      explanation: '暂时无法识别出唯一场景，请补充更具体的条件。',
      missingRequirements: ['intent_too_vague'],
      warnings: [],
      riskHints: [],
    };
  }

  private planDraft(scenarioKey: string, strategyKey: string, intent: string, name: string, options: { requiredFacts?: string[]; selectedTruthRefs?: string[] } = {}): AgentModelOutput {
    return {
      result: 'PLAN_DRAFT',
      intentSummary: intent,
      domain: scenarioKey.split('.')[0],
      scenarioKey,
      scenarioRevision: 1,
      strategyKey,
      requiredFacts: options.requiredFacts ?? [],
      selectedTruthRefs: options.selectedTruthRefs ?? [],
      requiredCapabilities: [],
      selectedSkillIds: ['PLAN_DRAFT'],
      toolRequirements: [],
      draftDefinition: null,
      explanation: `识别为「${name}」，将生成一份可继续编辑的计划草稿。`,
      missingRequirements: [],
      warnings: [],
      riskHints: [],
    };
  }
}
