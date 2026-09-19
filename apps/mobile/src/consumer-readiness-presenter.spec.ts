import { describe, expect, it } from 'vitest';
import { consumerReadiness, consumerReadinessAction, consumerReadinessDetail, consumerReadinessLabel } from './consumer-readiness-presenter';

const READY_SCENARIO = { state: 'AUTOMATED_READY', missingFacts: [], missingCapabilities: [] };
const READY_CAPABILITY = { capabilityKey: 'READ_TRACKING', providerAvailability: 'AVAILABLE', implementation: 'PRODUCTION', grant: 'GRANTED', health: 'HEALTHY', usable: true };

describe('Consumer readiness presenter', () => {
  it('maps a fully ready scenario to READY', () => {
    expect(consumerReadiness({ scenario: READY_SCENARIO, capabilities: [READY_CAPABILITY] })).toBe('READY');
    expect(consumerReadinessLabel('READY')).toBe('可以使用');
    expect(consumerReadinessAction('READY')).toContain('使用');
  });

  it('maps missing capabilities or no connections to NEEDS_CONNECTION', () => {
    expect(consumerReadiness({ scenario: { ...READY_SCENARIO, missingCapabilities: ['READ_TRACKING'] }, capabilities: [] })).toBe('NEEDS_CONNECTION');
    expect(consumerReadiness({ scenario: READY_SCENARIO, capabilities: [], runtime: { connectionCount: 0 } })).toBe('NEEDS_CONNECTION');
  });

  it('maps revoked or expired grants to NEEDS_PERMISSION', () => {
    const revoked = { ...READY_CAPABILITY, grant: 'REVOKED' };
    const expired = { ...READY_CAPABILITY, health: 'REAUTHORIZATION_REQUIRED', usable: false };
    expect(consumerReadiness({ scenario: READY_SCENARIO, capabilities: [revoked] })).toBe('NEEDS_PERMISSION');
    expect(consumerReadiness({ scenario: READY_SCENARIO, capabilities: [expired] })).toBe('NEEDS_PERMISSION');
    expect(consumerReadinessLabel('NEEDS_PERMISSION')).toBe('需要授权');
  });

  it('maps missing facts to NEEDS_DATA', () => {
    expect(consumerReadiness({ scenario: { ...READY_SCENARIO, missingFacts: ['shipment.status'] }, capabilities: [READY_CAPABILITY] })).toBe('NEEDS_DATA');
  });

  it('maps device offline from runtime or capability health', () => {
    expect(consumerReadiness({ scenario: READY_SCENARIO, capabilities: [READY_CAPABILITY], runtime: { deviceOffline: true } })).toBe('DEVICE_OFFLINE');
    expect(consumerReadiness({ scenario: READY_SCENARIO, capabilities: [{ ...READY_CAPABILITY, health: 'DEVICE_OFFLINE', usable: false }] })).toBe('DEVICE_OFFLINE');
    expect(consumerReadinessLabel('DEVICE_OFFLINE')).toBe('手机离线');
  });

  it('maps provider unavailability and disabled implementation to SERVICE_UNAVAILABLE', () => {
    expect(consumerReadiness({ scenario: READY_SCENARIO, capabilities: [READY_CAPABILITY], runtime: { providerUnavailable: true } })).toBe('SERVICE_UNAVAILABLE');
    expect(consumerReadiness({ scenario: { ...READY_SCENARIO, state: 'DISABLED' }, capabilities: [READY_CAPABILITY] })).toBe('SERVICE_UNAVAILABLE');
    expect(consumerReadiness({ scenario: READY_SCENARIO, capabilities: [{ ...READY_CAPABILITY, providerAvailability: 'UNAVAILABLE', usable: false }] })).toBe('SERVICE_UNAVAILABLE');
  });

  it('maps assisted/confirmation-required scenarios to NEEDS_CONFIRMATION', () => {
    expect(consumerReadiness({ scenario: { ...READY_SCENARIO, state: 'ASSISTED_READY' }, capabilities: [READY_CAPABILITY] })).toBe('NEEDS_CONFIRMATION');
    expect(consumerReadiness({ scenario: READY_SCENARIO, capabilities: [READY_CAPABILITY], runtime: { requiresConfirmation: true } })).toBe('NEEDS_CONFIRMATION');
  });

  it('maps runtime result-unknown to RESULT_UNKNOWN', () => {
    expect(consumerReadiness({ scenario: READY_SCENARIO, capabilities: [READY_CAPABILITY], runtime: { resultUnknown: true } })).toBe('RESULT_UNKNOWN');
    expect(consumerReadinessLabel('RESULT_UNKNOWN')).toBe('无法确认执行结果');
  });

  it('never reports READY while a capability is still awaiting/unusable', () => {
    const awaiting = { ...READY_CAPABILITY, grant: 'UNKNOWN', health: 'UNKNOWN', usable: false };
    expect(consumerReadiness({ scenario: READY_SCENARIO, capabilities: [awaiting] })).not.toBe('READY');
    expect(consumerReadinessDetail('NEEDS_CONNECTION')).toContain('连接');
  });
});
