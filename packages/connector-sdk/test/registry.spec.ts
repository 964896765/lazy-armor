import { describe, expect, it } from 'vitest';
import type { Connector } from '../src';
import { ConnectorRegistry } from '../src';

const connector: Connector = {
  metadata: () => ({
    key: 'manual',
    name: '手动输入',
    description: '测试',
    version: '1.0.0',
    providerType: 'manual',
    productionStatus: 'PRODUCTION_READY',
    authentication: { type: 'none' },
    supportsRefresh: false,
    supportsRevoke: false,
    supportsWebhook: false,
    supportsHealthCheck: true,
    sandboxSupport: 'full',
    rateLimitStrategy: 'unknown',
  }),
  capabilities: () => [{ key: 'MANUAL_INPUT', name: '手动输入', riskLevel: 'R0', operation: 'read' }],
  validateConnection: async () => ({ status: 'healthy', checkedAt: new Date().toISOString() }),
};

describe('ConnectorRegistry', () => {
  it('registers, gets, lists and exposes capabilities', () => {
    const registry = new ConnectorRegistry();
    registry.register(connector);
    expect(registry.get('manual')).toBe(connector);
    expect(registry.list()).toHaveLength(1);
    expect(registry.capabilities('manual')[0]?.key).toBe('MANUAL_INPUT');
    expect(registry.provider('manual').providerType).toBe('manual');
    expect(registry.supportsOperation('manual', 'read')).toBe(true);
  });

  it('rejects duplicate registrations', () => {
    const registry = new ConnectorRegistry();
    registry.register(connector);
    expect(() => registry.register(connector)).toThrow(/already registered/);
  });
});
