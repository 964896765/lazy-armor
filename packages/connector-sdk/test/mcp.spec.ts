import { describe, expect, it } from 'vitest';
import {
  FixtureMcpServer,
  LocalTestMcpServer,
  McpClient,
  McpClientError,
  describeMcpTool,
  mcpCapabilityKey,
} from '../src/mcp';

const readHandler = {
  toolName: 'read_connection_health',
  description: 'Reads connection health',
  inputSchema: { type: 'object', properties: { subjectKey: { type: 'string' } }, required: ['subjectKey'], additionalProperties: false },
  outputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['healthy', 'degraded'] }, subjectKey: { type: 'string' } }, required: ['status'], additionalProperties: false },
  effectClass: 'READ_ONLY' as const,
  riskHint: 'R0',
  async invoke(args: Record<string, unknown>) {
    return { status: 'healthy', subjectKey: args.subjectKey };
  },
};

const sideEffectHandler = {
  toolName: 'external_side_effect',
  description: 'External side effect',
  inputSchema: { type: 'object', properties: { payload: { type: 'string' } }, required: ['payload'], additionalProperties: false },
  outputSchema: { type: 'object', properties: { applied: { type: 'boolean' } }, required: ['applied'], additionalProperties: false },
  effectClass: 'EXTERNAL_SIDE_EFFECT' as const,
  riskHint: 'R3',
  verificationMethod: 'READ_BACK',
  async invoke(args: Record<string, unknown>) {
    return { applied: true, payload: args.payload };
  },
};

describe('R7 MCP common contract', () => {
  it('derives a stable capability key and descriptor', () => {
    expect(mcpCapabilityKey('ext-fixture-read', 'read_connection_health')).toBe('MCP_EXT_FIXTURE_READ_READ_CONNECTION_HEALTH');
    const descriptor = describeMcpTool('ext-fixture-read', readHandler, false);
    expect(descriptor.capabilityKey).toContain('MCP_');
    expect(descriptor.effectClass).toBe('READ_ONLY');
    expect(descriptor.enabled).toBe(false);
    expect(descriptor.requiresApproval).toBe(false);
  });

  it('marks external side-effect tools as requiring approval', () => {
    const descriptor = describeMcpTool('ext-fixture-side-effect', sideEffectHandler, false);
    expect(descriptor.effectClass).toBe('EXTERNAL_SIDE_EFFECT');
    expect(descriptor.requiresApproval).toBe(true);
  });

  it('discovers -> binds -> invokes -> validates schema -> produces evidence', async () => {
    const server = new LocalTestMcpServer('local-test', 'Local Test');
    server.register(readHandler);
    const client = new McpClient({ allowedServers: ['local-test'], allowedTools: ['read_connection_health'] }, new Map([['local-test', server.transport]]));
    const discovered = await client.discover('local-test');
    expect(discovered.authorized).toBe(true);
    const descriptor = client.describeTool('local-test', 'read_connection_health', true);
    const result = await client.invokeTool({ serverId: 'local-test', toolName: 'read_connection_health', arguments: { subjectKey: 'conn-1' }, requestId: 'req-1' }, descriptor.schemaHash, descriptor.effectClass);
    expect(result.ok).toBe(true);
    expect(result.content).toEqual({ status: 'healthy', subjectKey: 'conn-1' });
    expect(result.evidence.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed on unknown server/tool and unbound schema change', async () => {
    const server = new LocalTestMcpServer('local-test2', 'Local Test 2');
    server.register(readHandler);
    const client = new McpClient({ allowedServers: ['local-test2'] }, new Map([['local-test2', server.transport]]));
    await expect(client.discover('unknown')).rejects.toThrow(McpClientError);
    await client.discover('local-test2');
    const descriptor = client.describeTool('local-test2', 'read_connection_health');
    // Schema changed: bound hash no longer matches the live tool.
    await expect(client.invokeTool({ serverId: 'local-test2', toolName: 'read_connection_health', arguments: { subjectKey: 'x' }, requestId: 'r' }, 'deadbeef', 'READ_ONLY')).rejects.toThrow(/MCP_SCHEMA_CHANGED/);
    await expect(client.invokeTool({ serverId: 'local-test2', toolName: 'read_connection_health', arguments: {}, requestId: 'r' }, descriptor.schemaHash, 'READ_ONLY')).rejects.toThrow(/required/);
  });

  it('rejects oversized responses and invalid results fail-closed', async () => {
    const server = new FixtureMcpServer('fixture-oversize', 'Oversize Fixture');
    server.register(readHandler);
    server.fault('read_connection_health', { kind: 'oversized_response' });
    const client = new McpClient({ allowedServers: ['fixture-oversize'] }, new Map([['fixture-oversize', server.transport]]));
    await client.discover('fixture-oversize');
    const descriptor = client.describeTool('fixture-oversize', 'read_connection_health');
    await expect(client.invokeTool({ serverId: 'fixture-oversize', toolName: 'read_connection_health', arguments: { subjectKey: 'x' }, requestId: 'r' }, descriptor.schemaHash, 'READ_ONLY')).rejects.toThrow(/MCP_RESPONSE_TOO_LARGE/);
  });

  it('never invokes side-effect tools through the direct read path', async () => {
    const server = new FixtureMcpServer('fixture-side', 'Side Fixture');
    server.register(sideEffectHandler);
    const client = new McpClient({ allowedServers: ['fixture-side'] }, new Map([['fixture-side', server.transport]]));
    await client.discover('fixture-side');
    const descriptor = client.describeTool('fixture-side', 'external_side_effect');
    await expect(client.invokeTool({ serverId: 'fixture-side', toolName: 'external_side_effect', arguments: { payload: 'x' }, requestId: 'r' }, descriptor.schemaHash, 'EXTERNAL_SIDE_EFFECT')).rejects.toThrow(/MCP_SIDE_EFFECT_REQUIRES_EXECUTION/);
    expect(server.callCount).toBe(0);
  });
});
