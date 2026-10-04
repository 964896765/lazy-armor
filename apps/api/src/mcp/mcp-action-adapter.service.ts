import { Injectable } from '@nestjs/common';
import type { McpToolCallResult } from '@lazy-armor/connector-sdk';

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

/** Audit rows and caller-supplied hashes are not execution authority.
 * The legacy entry must not invoke tools. MCP side effects require the existing
 * canonical side-effect outbox and VerificationService before being enabled.
 */
@Injectable()
export class McpActionAdapter {
  async executeSideEffect(_userId: string, _input: McpSideEffectExecution): Promise<McpSideEffectExecutionResult> {
    return {
      ok: false, result: null,
      verification: { method: 'NONE', status: 'UNVERIFIED', evidenceHash: '' },
      error: 'MCP_CANONICAL_EXECUTION_NOT_CONNECTED: requires capability resolution, risk, approval, execution outbox and verification',
    };
  }
}
