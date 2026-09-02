import type { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { describe, expect, it } from 'vitest';
import { createConnectorRegistry, shouldRegisterTrueProcessHarnessConnector } from '../src/connectors/connectors.module';

describe.sequential('P0-H4 true-process harness fail-closed gate', { timeout: 60000 }, () => {
  it('allows the harness only in development with an explicit flag', async () => {
    expect(shouldRegisterTrueProcessHarnessConnector({
      NODE_ENV: 'development',
      APP_ENV: 'development',
      LAZY_ARMOR_ENABLE_TRUE_PROCESS_TEST_CONNECTOR: '1',
    })).toBe(true);
    expect(shouldRegisterTrueProcessHarnessConnector({
      NODE_ENV: 'development',
      APP_ENV: 'development',
      LAZY_ARMOR_ENABLE_TRUE_PROCESS_TEST_CONNECTOR: '0',
    })).toBe(false);
    expect(shouldRegisterTrueProcessHarnessConnector({
      NODE_ENV: 'development',
      APP_ENV: 'staging',
      LAZY_ARMOR_ENABLE_TRUE_PROCESS_TEST_CONNECTOR: '1',
    })).toBe(false);
    expect(shouldRegisterTrueProcessHarnessConnector({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      LAZY_ARMOR_ENABLE_TRUE_PROCESS_TEST_CONNECTOR: '1',
    })).toBe(false);
  });

  it('never registers the harness in production or staging even when the flag is set', async () => {
    const production = bootRegistry({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      LAZY_ARMOR_ENABLE_TRUE_PROCESS_TEST_CONNECTOR: '1',
    });
    expect(production.list().some((connector) => connector.metadata().key === 'true_process_test')).toBe(false);

    const staging = bootRegistry({
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      LAZY_ARMOR_ENABLE_TRUE_PROCESS_TEST_CONNECTOR: '1',
    });
    expect(staging.list().some((connector) => connector.metadata().key === 'true_process_test')).toBe(false);
  });

  it('registers the harness only when development explicitly enables it and keeps it disabled in metadata', async () => {
    const disabled = bootRegistry({
      NODE_ENV: 'development',
      APP_ENV: 'development',
      LAZY_ARMOR_ENABLE_TRUE_PROCESS_TEST_CONNECTOR: undefined,
    });
    expect(disabled.list().some((connector) => connector.metadata().key === 'true_process_test')).toBe(false);

    const enabled = bootRegistry({
      NODE_ENV: 'development',
      APP_ENV: 'development',
      LAZY_ARMOR_ENABLE_TRUE_PROCESS_TEST_CONNECTOR: '1',
    });
    const harness = enabled.list().find((connector) => connector.metadata().key === 'true_process_test');
    expect(harness).toBeTruthy();
    expect(harness?.metadata()).toMatchObject({
      productionStatus: 'DISABLED',
    });
    expect(harness?.metadata().description).toContain('test-only');
    expect(harness?.metadata().description).toContain('never production');
    expect(harness?.metadata().description).toContain('never staging');
  });

  function bootRegistry(overrides: Partial<NodeJS.ProcessEnv>): ConnectorRegistry {
    return createConnectorRegistry({
      NODE_ENV: overrides.NODE_ENV ?? 'development',
      APP_ENV: overrides.APP_ENV ?? 'development',
      LAZY_ARMOR_ENABLE_TRUE_PROCESS_TEST_CONNECTOR: overrides.LAZY_ARMOR_ENABLE_TRUE_PROCESS_TEST_CONNECTOR,
    });
  }
});
