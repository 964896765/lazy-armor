import { describe, expect, it } from 'vitest';
import { McpActionAdapter } from '../src/mcp/mcp-action-adapter.service';

describe('MCP legacy side-effect authority', () => {
  it('cannot dispatch or report verification using caller-supplied approval evidence', async () => {
    const result = await new McpActionAdapter().executeSideEffect('owner', {
      serverId: 'server', toolName: 'write', arguments: { amount: 100 }, requestId: 'request',
      executionAuthorization: { planId: 'plan', approvalSnapshotHash: 'a'.repeat(64), effectiveRiskLevel: 'R3' },
    });
    expect(result).toMatchObject({ ok: false, result: null, verification: { method: 'NONE', status: 'UNVERIFIED', evidenceHash: '' } });
    expect(result.error).toContain('MCP_CANONICAL_EXECUTION_NOT_CONNECTED');
  });
});
