import { buildConnectorManifest, validateConnectorManifest } from '@lazy-armor/connector-sdk';
import { describe, expect, it } from 'vitest';
import { createConnectorRegistry } from '../src/connectors/connectors.module';

describe('P5-E connector manifest contract harness', () => {
  it('validates every registered adapter through one fail-closed harness', () => {
    const registry = createConnectorRegistry({ NODE_ENV: 'test' });
    const manifests = registry.list().map((connector) => validateConnectorManifest(connector));
    expect(manifests).toHaveLength(8);
    for (const manifest of manifests) {
      expect(manifest).toMatchObject({
        schemaVersion: '1',
        connectorSdkVersion: '0.1.0',
        metadata: {
          version: expect.stringMatching(/^\d+\.\d+\.\d+/),
          authentication: { type: expect.any(String) },
          sandboxSupport: expect.any(String),
          productionStatus: expect.any(String),
        },
      });
      expect(manifest.capabilities.length).toBeGreaterThan(0);
      expect(manifest.capabilities.every((capability) => capability.requiredPermission && capability.sideEffectContract.retrySafety)).toBe(true);
    }
  });

  it('normalizes permissions, risk, side effects, retry safety and production status in the manifest', () => {
    const registry = createConnectorRegistry({ NODE_ENV: 'test' });
    const calendar = buildConnectorManifest(registry.get('google_calendar'));
    expect(calendar.metadata.productionStatus).toBe('BETA');
    expect(calendar.permissions).toEqual(expect.arrayContaining(['READ_EVENT', 'CREATE_EVENT', 'UPDATE_EVENT']));
    expect(calendar.capabilities.find((item) => item.key === 'CREATE_EVENT')).toMatchObject({
      riskLevel: 'R3',
      providerAvailability: 'disabled',
      sideEffectContract: {
        sideEffect: true,
        supportsIdempotencyKey: true,
        supportsOperationLookup: true,
        retrySafety: 'ambiguous',
      },
    });
  });
});
