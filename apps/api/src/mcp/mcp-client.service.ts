import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  McpClientError,
  type McpEvidence,
  type McpToolCallRequest,
  type McpToolCallResult,
} from '@lazy-armor/connector-sdk';
import type { JsonValue, SourceObservationInput } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { McpServerRegistryService } from './mcp-server-registry.service';
import { AuditService } from '../audit/audit.service';
import { RealityPipelineService } from '../reality-pipeline/reality-pipeline.service';
import { CREDENTIAL_PROVIDER, type CredentialProvider } from '../credentials/credential-provider';

/**
 * MCP client orchestration adapter. Routes discovered MCP tools back onto the
 * existing Capability/Reality/Truth chain. READ_ONLY tools get the short path
 * (authorization + allowlist + schema validation + audit); side-effect tools
 * are rejected here and must go through Plan -> Execution -> McpActionAdapter.
 */
@Injectable()
export class McpClientService {
  constructor(
    private readonly registry: McpServerRegistryService,
    private readonly reality: RealityPipelineService,
    private readonly audit: AuditService,
    @Inject(CREDENTIAL_PROVIDER) private readonly credentials: CredentialProvider,
  ) {}

  async discover(serverId: string) {
    return this.registry.discover(serverId);
  }

  async bindTool(serverId: string, toolName: string) {
    return this.registry.bindTool(serverId, toolName);
  }

  listServers() {
    return this.registry.listServers();
  }

  listTools(serverId: string) {
    return this.registry.listTools(serverId);
  }

  async invokeReadTool(userId: string, request: McpToolCallRequest): Promise<McpToolCallResult> {
    const binding = this.registry.requireBinding(request.serverId, request.toolName);
    const tool = this.registry.getTool(request.serverId, request.toolName);
    if (tool.effectClass !== 'READ_ONLY') {
      throw new McpClientError('MCP_SIDE_EFFECT_REQUIRES_EXECUTION', `Tool ${request.toolName} is a side effect; use Plan->Execution`, request.serverId, request.toolName);
    }
    await this.assertCredentialAvailable(request.serverId);
    const result = await this.registry.getClient().invokeTool({ ...request, userId }, binding.schemaHash, tool.effectClass);
    await this.auditMCPCall(userId, request.serverId, request.toolName, result.evidence, result.ok ? 'success' : 'failure');
    return result;
  }

  /** Golden Journey 5: READ tool -> binding -> client -> evidence -> RealityPipeline -> Truth. */
  async readToolToTruth(userId: string, request: McpToolCallRequest, options: { parserKey: SourceObservationInput['parserKey']; resourceHint: string; confirm?: boolean }): Promise<{ observation: Awaited<ReturnType<RealityPipelineService['ingest']>>; truth?: Awaited<ReturnType<RealityPipelineService['truthResponse']>> }> {
    const result = await this.invokeReadTool(userId, request);
    if (!result.ok || !result.content) throw new McpClientError('MCP_SERVER_UNAVAILABLE', 'MCP read produced no content', request.serverId, request.toolName);
    const observation = await this.reality.ingest(userId, {
      sourceMode: 'OFFICIAL_API',
      providerKey: request.serverId,
      connectionId: null,
      externalEventKey: request.requestId,
      parserKey: options.parserKey,
      resourceHint: options.resourceHint,
      payload: result.content as Record<string, JsonValue>,
      evidenceHash: result.evidence.evidenceHash,
      observedAt: result.evidence.observedAt,
      occurredAt: result.evidence.observedAt,
    });
    let truth: Awaited<ReturnType<RealityPipelineService['truthResponse']>> | undefined;
    if (options.confirm && observation.candidates[0]) {
      truth = await this.reality.confirmCandidate(userId, observation.candidates[0].id, { sourceReceiptId: null, verifiedBy: 'mcp_evidence', verificationMethod: 'source_evidence' });
    }
    return { observation, truth };
  }

  private async assertCredentialAvailable(serverId: string) {
    const descriptor = this.registry.listServers().find((server) => server.serverId === serverId);
    if (!descriptor?.credentialRef) return;
    try {
      await this.credentials.currentVersion(descriptor.credentialRef);
    } catch {
      throw new McpClientError('MCP_CREDENTIAL_UNAVAILABLE', `Credential unavailable for MCP server ${serverId}`, serverId);
    }
  }

  private async auditMCPCall(userId: string, serverId: string, toolName: string, evidence: McpEvidence, result: 'success' | 'failure') {
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'MCP_TOOL_READ_INVOKED',
      resourceType: 'mcp_tool_call', resourceId: evidence.requestId, userId,
      correlationId: evidence.requestId,
      after: { serverId, toolName, evidenceHash: evidence.evidenceHash, schemaHash: evidence.schemaHash },
      changeSummary: `MCP read tool ${serverId}/${toolName} invoked`,
      source: 'api', result,
    });
  }
}

export function evidenceDigest(serverId: string, toolName: string, requestId: string, content: unknown): string {
  return createHash('sha256').update(JSON.stringify({ serverId, toolName, requestId, content })).digest('hex');
}

export function newMCPRequestId(): string {
  return newId();
}
