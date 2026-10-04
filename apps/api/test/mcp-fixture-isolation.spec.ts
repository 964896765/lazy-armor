import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServerRegistryService } from '../src/mcp/mcp-server-registry.service';

afterEach(() => vi.unstubAllEnvs());
describe('MCP fixture isolation', () => {
 it.each(['production', 'development'])('does not expose fixture transports in %s', async environment => {
  vi.stubEnv('NODE_ENV', environment);
  const registry = new McpServerRegistryService(); registry.onModuleInit();
  expect(registry.listServers()).toEqual([]); expect(registry.listEnabledTools()).toEqual([]);
  await expect(registry.discover('ext-fixture-read')).rejects.toThrow('Unknown MCP server');
 });
 it('retains explicit fixtures for test suites', async () => {
  vi.stubEnv('NODE_ENV', 'test');
  const registry = new McpServerRegistryService(); registry.onModuleInit();
  const descriptor = await registry.discover('ext-fixture-read');
  expect(descriptor.serverId).toBe('ext-fixture-read');
 });
});
