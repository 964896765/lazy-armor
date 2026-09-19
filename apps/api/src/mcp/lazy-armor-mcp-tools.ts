import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ConnectionsService } from '../connections/connections.service';
import { PlansService } from '../plans/plans.service';
import { RuntimeCatalogRegistryService } from '../runtime-catalog/runtime-catalog-registry.service';
import { ReadinessEvidenceService } from '../runtime-catalog/readiness-evidence.service';
import { RealityPipelineService } from '../reality-pipeline/reality-pipeline.service';
import { CapabilityUsabilityService } from '../provider-capabilities/capability-usability.service';

export interface LazyArmorMcpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  effectClass: 'READ_ONLY' | 'LOCAL_MUTATION';
}

const TOOLS: LazyArmorMcpToolDescriptor[] = [
  { name: 'get_today', description: '读取今天的日期与时区', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, effectClass: 'READ_ONLY' },
  { name: 'list_plans', description: '列出当前用户的计划', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, effectClass: 'READ_ONLY' },
  { name: 'get_plan', description: '读取当前用户的单个计划', inputSchema: { type: 'object', properties: { planId: { type: 'string' } }, required: ['planId'], additionalProperties: false }, effectClass: 'READ_ONLY' },
  { name: 'list_truth', description: '列出当前用户已验证事实', inputSchema: { type: 'object', properties: { resourceKey: { type: 'string' } }, additionalProperties: false }, effectClass: 'READ_ONLY' },
  { name: 'get_truth', description: '读取当前用户的单条已验证事实', inputSchema: { type: 'object', properties: { truthId: { type: 'string' } }, required: ['truthId'], additionalProperties: false }, effectClass: 'READ_ONLY' },
  { name: 'list_connections', description: '列出当前用户的连接（不含凭据）', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, effectClass: 'READ_ONLY' },
  { name: 'get_connection_readiness', description: '读取单个连接的六维能力就绪度（不含凭据）', inputSchema: { type: 'object', properties: { connectionId: { type: 'string' } }, required: ['connectionId'], additionalProperties: false }, effectClass: 'READ_ONLY' },
  { name: 'list_capabilities', description: '列出当前用户的能力就绪度', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, effectClass: 'READ_ONLY' },
  { name: 'get_capability', description: '读取单个能力就绪度', inputSchema: { type: 'object', properties: { capabilityKey: { type: 'string' } }, required: ['capabilityKey'], additionalProperties: false }, effectClass: 'READ_ONLY' },
  { name: 'list_scenarios', description: '列出场景目录', inputSchema: { type: 'object', properties: { domain: { type: 'string' } }, additionalProperties: false }, effectClass: 'READ_ONLY' },
  { name: 'get_scenario', description: '读取单个场景定义', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false }, effectClass: 'READ_ONLY' },
  { name: 'create_plan_draft', description: '创建计划草稿（只创建 Draft，绝不激活/执行/审批）', inputSchema: { type: 'object', properties: { scenarioKey: { type: 'string' }, strategy: { type: 'string' }, name: { type: 'string' } }, required: ['scenarioKey'], additionalProperties: false }, effectClass: 'LOCAL_MUTATION' },
  { name: 'explain_readiness', description: '解释场景就绪度', inputSchema: { type: 'object', properties: { scenarioKey: { type: 'string' } }, required: ['scenarioKey'], additionalProperties: false }, effectClass: 'READ_ONLY' },
];

@Injectable()
export class LazyArmorMcpToolService {
  constructor(
    private readonly catalog: RuntimeCatalogRegistryService,
    private readonly readiness: ReadinessEvidenceService,
    private readonly reality: RealityPipelineService,
    private readonly plans: PlansService,
    private readonly connections: ConnectionsService,
    private readonly usability: CapabilityUsabilityService,
    private readonly audit: AuditService,
  ) {}

  listTools() { return TOOLS.map((tool) => ({ ...tool })); }

  async call(userId: string, toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this.dispatch(userId, toolName, args);
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'LAZY_ARMOR_MCP_TOOL_CALLED',
      resourceType: 'lazy_armor_mcp_tool', resourceId: toolName, userId,
      after: { toolName }, changeSummary: `Lazy Armor MCP tool ${toolName} called`,
      source: 'api', result: 'success',
    });
    return result;
  }

  private async dispatch(userId: string, toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (toolName) {
      case 'get_today': return { date: new Date().toISOString().slice(0, 10), timezone: 'Asia/Shanghai' };
      case 'list_plans': return { plans: await this.plans.list(userId) };
      case 'get_plan': return { plan: await this.plans.get(userId, this.requireString(args, 'planId')) };
      case 'list_truth': {
        const rows = await this.reality.listTruth(userId);
        return { truths: rows };
      }
      case 'get_truth': return { truth: await this.reality.truthResponse(userId, this.requireString(args, 'truthId')) };
      case 'list_connections': return { connections: await this.connections.list(userId) };
      case 'get_connection_readiness': return { readiness: await this.usability.resolveConnection(userId, this.requireString(args, 'connectionId')) };
      case 'list_capabilities': return { capabilities: await this.readiness.projectCapabilities(userId) };
      case 'get_capability': {
        const key = this.requireString(args, 'capabilityKey');
        const capabilities = await this.readiness.projectCapabilities(userId);
        const capability = capabilities.find((item) => item.capabilityKey === key);
        if (!capability) throw new NotFoundException('Capability not found');
        return { capability };
      }
      case 'list_scenarios': {
        const domain = typeof args.domain === 'string' && args.domain ? args.domain : undefined;
        return { scenarios: this.catalog.listScenarios(domain) };
      }
      case 'get_scenario': return { scenario: this.catalog.getScenario(this.requireString(args, 'key')) };
      case 'create_plan_draft': {
        const scenarioKey = this.requireString(args, 'scenarioKey');
        const strategy = typeof args.strategy === 'string' && args.strategy ? args.strategy : undefined;
        const name = typeof args.name === 'string' && args.name ? args.name : undefined;
        const compiled = await this.catalog.compile(userId, scenarioKey, { strategy: strategy as never, name });
        const plan = await this.plans.create(userId, compiled.definitionInput);
        return { planId: plan.id, status: plan.status, draft: true };
      }
      case 'explain_readiness': {
        const scenarioKey = this.requireString(args, 'scenarioKey');
        const scenario = this.catalog.getScenario(scenarioKey);
        const evidence = await this.readiness.projectScenarioRuntimeEvidence(userId, scenario);
        return { scenarioKey, readiness: evidence.readiness, capabilities: evidence.capabilities, missingFacts: evidence.missingFacts };
      }
      default:
        throw new BadRequestException(`Unknown Lazy Armor MCP tool: ${toolName}`);
    }
  }

  private requireString(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`Missing argument: ${key}`);
    return value;
  }
}
