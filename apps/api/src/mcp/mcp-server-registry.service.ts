import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  FixtureMcpServer,
  McpClient,
  McpClientError,
  type McpConnectionHealth,
  type McpServerDescriptor,
  type McpToolBinding,
  type McpToolDescriptor,
  type McpTransport,
} from '@lazy-armor/connector-sdk';
import { newId } from '@lazy-armor/shared';
import type { AgentToolRef } from '../ai-adapter/agent-context-compiler.service';

/**
 * MCP server registry adapter. Maps discovered external MCP tools onto the
 * existing Capability chain (each tool becomes a `capabilityKey`). This is NOT
 * a new Tool Registry / MCP framework — it is a fail-closed binding table.
 *
 * - Server endpoints/commands come only from code allowlist here (plus admin
 *   config would feed the same allowlist). Unknown server/tool => error.
 * - A newly discovered external tool is DISABLED until an operator binds it.
 * - Schema change degrades readiness and forces binding revalidation.
 */
@Injectable()
export class McpServerRegistryService implements OnModuleInit {
  private readonly transports = new Map<string, McpTransport>();
  private readonly fixtures = new Map<string, FixtureMcpServer>();
  private readonly descriptors = new Map<string, McpServerDescriptor>();
  private readonly tools = new Map<string, Map<string, McpToolDescriptor>>();
  private readonly bindings = new Map<string, McpToolBinding>();
  private client!: McpClient;

  onModuleInit() {
    this.seedFixtureServers();
    this.client = new McpClient(
      {
        allowedServers: [...this.transports.keys()],
        timeoutMs: 5_000,
        maxResponseBytes: 1_000_000,
        maxRequestBytes: 256_000,
        allowSideEffect: false,
      },
      this.transports,
    );
  }

  getClient(): McpClient {
    return this.client;
  }

  transport(serverId: string): McpTransport {
    const transport = this.transports.get(serverId);
    if (!transport) throw new McpClientError('UNKNOWN_MCP_SERVER', `Unknown MCP server: ${serverId}`, serverId);
    return transport;
  }

  registerServer(descriptor: McpServerDescriptor, transport: McpTransport) {
    this.transports.set(descriptor.serverId, transport);
    this.descriptors.set(descriptor.serverId, descriptor);
  }

  async discover(serverId: string): Promise<McpServerDescriptor> {
    const transport = this.transports.get(serverId);
    if (!transport) throw new McpClientError('UNKNOWN_MCP_SERVER', `Unknown MCP server: ${serverId}`, serverId);
    const descriptor = await this.client.discover(serverId);
    this.descriptors.set(serverId, descriptor);
    const listed = this.client.listTools(serverId);
    const byName = new Map<string, McpToolDescriptor>();
    for (const tool of listed) byName.set(tool.toolName, tool);
    this.tools.set(serverId, byName);
    return descriptor;
  }

  listServers(): McpServerDescriptor[] {
    return [...this.descriptors.values()];
  }

  listTools(serverId: string): McpToolDescriptor[] {
    return [...(this.tools.get(serverId)?.values() ?? [])];
  }

  getTool(serverId: string, toolName: string): McpToolDescriptor {
    const tool = this.tools.get(serverId)?.get(toolName);
    if (!tool) throw new McpClientError('UNKNOWN_MCP_TOOL', `Unknown MCP tool: ${serverId}/${toolName}`, serverId, toolName);
    return tool;
  }

  /** Operator binding: maps tool -> capability and enables it. */
  async bindTool(serverId: string, toolName: string): Promise<McpToolBinding> {
    if (!this.tools.has(serverId)) await this.discover(serverId);
    const tool = this.getTool(serverId, toolName);
    const existing = this.bindings.get(`${serverId}/${toolName}`);
    if (existing && !existing.revalidationRequired && existing.schemaHash === tool.schemaHash) return existing;
    const binding: McpToolBinding = {
      bindingId: newId(),
      serverId,
      toolName,
      capabilityKey: tool.capabilityKey,
      effectClass: tool.effectClass,
      enabled: true,
      schemaHash: tool.schemaHash,
      boundAt: new Date().toISOString(),
      revalidationRequired: false,
    };
    this.bindings.set(`${serverId}/${toolName}`, binding);
    tool.enabled = true;
    return binding;
  }

  getBinding(serverId: string, toolName: string): McpToolBinding | undefined {
    return this.bindings.get(`${serverId}/${toolName}`);
  }

  requireBinding(serverId: string, toolName: string): McpToolBinding {
    const binding = this.getBinding(serverId, toolName);
    if (!binding) throw new McpClientError('UNBOUND_MCP_TOOL', `Tool ${serverId}/${toolName} is not bound`, serverId, toolName);
    if (binding.revalidationRequired) throw new McpClientError('MCP_SCHEMA_CHANGED', `Tool ${serverId}/${toolName} requires revalidation`, serverId, toolName);
    if (!binding.enabled) throw new McpClientError('MCP_TOOL_DISABLED', `Tool ${serverId}/${toolName} is disabled`, serverId, toolName);
    return binding;
  }

  markSchemaChanged(serverId: string, toolName: string): void {
    const binding = this.getBinding(serverId, toolName);
    if (binding) {
      binding.revalidationRequired = true;
      binding.enabled = false;
    }
    const descriptor = this.descriptors.get(serverId);
    if (descriptor) descriptor.healthy = false;
  }

  async health(serverId: string): Promise<McpConnectionHealth> {
    const descriptor = this.descriptors.get(serverId);
    return this.client.health(serverId, descriptor?.toolCatalogHash ?? null);
  }

  listEnabledTools(): AgentToolRef[] {
    const refs: AgentToolRef[] = [];
    for (const binding of this.bindings.values()) {
      if (!binding.enabled || binding.revalidationRequired) continue;
      const tool = this.tools.get(binding.serverId)?.get(binding.toolName);
      if (!tool) continue;
      refs.push({
        serverId: binding.serverId,
        toolName: binding.toolName,
        capabilityKey: binding.capabilityKey,
        effectClass: tool.effectClass,
        enabled: true,
      });
    }
    return refs;
  }

  fixture(serverId: string): FixtureMcpServer | undefined {
    return this.fixtures.get(serverId);
  }

  private seedFixtureServers() {
    const readServer = new FixtureMcpServer('ext-fixture-read', 'External MCP Read Fixture');
    readServer.register({
      toolName: 'read_connection_health',
      description: 'Reads an external connection health fact (READ_ONLY fixture).',
      inputSchema: { type: 'object', properties: { subjectKey: { type: 'string' } }, required: ['subjectKey'], additionalProperties: false },
      outputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] }, subjectKey: { type: 'string' } }, required: ['status'], additionalProperties: false },
      effectClass: 'READ_ONLY',
      riskHint: 'R0',
      verificationMethod: null,
      async invoke(args) {
        return { status: 'healthy', subjectKey: typeof args.subjectKey === 'string' ? args.subjectKey : 'external-connection' };
      },
    });
    this.installFixture(readServer);

    const sideEffectServer = new FixtureMcpServer('ext-fixture-side-effect', 'External MCP Side-Effect Fixture');
    sideEffectServer.register({
      toolName: 'external_side_effect',
      description: 'External side-effect fixture (must go through Plan->Execution, never direct).',
      inputSchema: { type: 'object', properties: { payload: { type: 'string' } }, required: ['payload'], additionalProperties: false },
      outputSchema: { type: 'object', properties: { applied: { type: 'boolean' }, operationId: { type: 'string' } }, required: ['applied'], additionalProperties: false },
      effectClass: 'EXTERNAL_SIDE_EFFECT',
      riskHint: 'R3',
      verificationMethod: 'READ_BACK',
      async invoke(args) {
        return { applied: true, operationId: `op-${String(args.payload ?? '').slice(0, 8)}` };
      },
    });
    this.installFixture(sideEffectServer);
  }

  private installFixture(server: FixtureMcpServer) {
    this.fixtures.set(server.serverId, server);
    this.transports.set(server.serverId, server.transport);
  }
}
