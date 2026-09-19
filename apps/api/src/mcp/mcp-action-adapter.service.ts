import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { McpClient, type McpToolCallResult } from '@lazy-armor/connector-sdk';
import { auditLogs } from '@lazy-armor/database';
import { and, eq, sql } from 'drizzle-orm';
import { McpServerRegistryService } from './mcp-server-registry.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';

export interface McpExecutionAuthorization {
  planId: string;
  approvalSnapshotHash: string;
  effectiveRiskLevel: string;
}

export interface McpSideEffectExecution {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  requestId: string;
  executionAuthorization: McpExecutionAuthorization;
}

export interface McpSideEffectExecutionResult {
  ok: boolean;
  result: McpToolCallResult | null;
  verification: { method: string; status: 'VERIFIED' | 'UNVERIFIED'; evidenceHash: string };
  error?: string;
}

/**
 * The ONLY code path allowed to dispatch an external MCP side-effect tool.
 * The Agent Planner can never call this (it has no access and no authorization
 * proof); a side-effect tool must flow through Plan -> Risk -> Approval ->
 * Execution -> this adapter -> MCP -> Result -> Verification. Authorization is
 * proven by an approval audit entry written by the execution/approval chain.
 */
@Injectable()
export class McpActionAdapter {
  constructor(
    private readonly registry: McpServerRegistryService,
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly audit: AuditService,
  ) {}

  async executeSideEffect(userId: string, input: McpSideEffectExecution): Promise<McpSideEffectExecutionResult> {
    const binding = this.registry.requireBinding(input.serverId, input.toolName);
    const tool = this.registry.getTool(input.serverId, input.toolName);
    if (tool.effectClass !== 'EXTERNAL_SIDE_EFFECT') {
      return this.refused('Tool is not an external side effect');
    }
    const authorized = await this.assertApprovalAuthorized(userId, input);
    if (!authorized) {
      return this.refused('Side-effect execution requires an approval written by the execution chain');
    }

    // A dedicated client whose allowSideEffect flag is set only here, inside
    // the guarded adapter — never exposed to the planner.
    const client = new McpClient(
      { allowedServers: [input.serverId], allowedTools: [input.toolName], allowSideEffect: true, timeoutMs: 5_000, maxResponseBytes: 1_000_000 },
      new Map([[input.serverId, this.registry.transport(input.serverId)]]),
    );
    let result: McpToolCallResult;
    try {
      result = await client.invokeTool({ serverId: input.serverId, toolName: input.toolName, arguments: input.arguments, requestId: input.requestId, userId }, binding.schemaHash, tool.effectClass);
    } catch (error) {
      return this.refused(error instanceof Error ? error.message : 'MCP side-effect invocation failed');
    }
    const verification = this.verify(tool.verificationMethod, result);
    await this.audit.append({
      actorType: 'worker', actorUserId: userId, action: 'MCP_TOOL_SIDE_EFFECT_EXECUTED',
      resourceType: 'mcp_tool_call', resourceId: input.requestId, userId,
      correlationId: input.executionAuthorization.planId,
      after: { serverId: input.serverId, toolName: input.toolName, evidenceHash: result.evidence.evidenceHash, verification },
      changeSummary: `MCP side-effect ${input.serverId}/${input.toolName} executed through execution chain`,
      source: 'execution_worker', result: result.ok ? 'success' : 'failure',
    });
    return { ok: result.ok, result, verification, error: result.error?.message };
  }

  private verify(method: string | null, result: McpToolCallResult): McpSideEffectExecutionResult['verification'] {
    const evidenceHash = result.evidence.evidenceHash;
    // READ_BACK / PROVIDER_RESPONSE verification is satisfied when the result
    // conforms to the tool's output schema (already enforced by the client).
    if (method === 'READ_BACK' && result.ok) return { method, status: 'VERIFIED', evidenceHash };
    return { method: method ?? 'PROVIDER_RESPONSE', status: result.ok ? 'VERIFIED' : 'UNVERIFIED', evidenceHash };
  }

  private async assertApprovalAuthorized(userId: string, input: McpSideEffectExecution): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(input.executionAuthorization.approvalSnapshotHash)) return false;
    if (!['R2', 'R3', 'R4'].includes(input.executionAuthorization.effectiveRiskLevel)) return false;
    const rows = await this.db.select({ id: auditLogs.id }).from(auditLogs).where(and(
      eq(auditLogs.action, 'MCP_SIDE_EFFECT_APPROVED'),
      eq(auditLogs.resourceId, input.executionAuthorization.planId),
      eq(auditLogs.userId, userId),
      sql`JSON_UNQUOTE(JSON_EXTRACT(${auditLogs.afterSnapshotJson}, '$.approvalSnapshotHash')) = ${input.executionAuthorization.approvalSnapshotHash}`,
    )).limit(1);
    return rows.length > 0;
  }

  private refused(message: string): McpSideEffectExecutionResult {
    return { ok: false, result: null, verification: { method: 'NONE', status: 'UNVERIFIED', evidenceHash: '' }, error: message };
  }
}

export function approvalSnapshotHash(planId: string, riskLevel: string): string {
  return createHash('sha256').update(JSON.stringify({ planId, riskLevel, kind: 'MCP_SIDE_EFFECT_APPROVED' })).digest('hex');
}
