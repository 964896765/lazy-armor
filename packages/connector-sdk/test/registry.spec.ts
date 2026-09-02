import { describe, expect, it } from 'vitest';
import type { Connector } from '../src';
import { buildConnectorManifest, ConnectorRegistry } from '../src';

const connector: Connector = {
  metadata: () => ({
    key: 'manual',
    name: '手动输入',
    description: '测试',
    version: '1.0.0',
    connectorSdkVersion: '0.1.0',
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
  capabilities: () => [{ key: 'MANUAL_INPUT', name: '手动输入', riskLevel: 'R0', operation: 'read', requiredPermission: 'MANUAL_INPUT' }],
  read: async () => ({ ok: true, data: {} }),
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
    expect(buildConnectorManifest(connector)).toMatchObject({
      schemaVersion: '1',
      connectorSdkVersion: '0.1.0',
      permissions: ['MANUAL_INPUT'],
      capabilities: [{ key: 'MANUAL_INPUT', riskLevel: 'R0', sideEffectContract: { sideEffect: false, retrySafety: 'ambiguous' } }],
    });
  });

  it('rejects duplicate registrations', () => {
    const registry = new ConnectorRegistry();
    registry.register(connector);
    expect(() => registry.register(connector)).toThrow(/already registered/);
  });

  it('fails closed on an incompatible SDK or unsafe high-risk manifest', () => {
    const incompatible: Connector = { ...connector, metadata: () => ({ ...connector.metadata(), key: 'bad_sdk', connectorSdkVersion: '9.0.0' }) };
    expect(() => new ConnectorRegistry().register(incompatible)).toThrow(/incompatible/);
    const unsafe: Connector = {
      ...connector,
      metadata: () => ({ ...connector.metadata(), key: 'unsafe_high_risk' }),
      capabilities: () => [{ key: 'PAY_NOW', name: 'Pay', riskLevel: 'R4', operation: 'execute', requiredPermission: 'PAY_NOW', sideEffectContract: { sideEffect: false } }],
      execute: async () => ({ ok: true, data: {} }),
    };
    expect(() => new ConnectorRegistry().register(unsafe)).toThrow(/high-risk capability must declare sideEffect/);
  });
});
