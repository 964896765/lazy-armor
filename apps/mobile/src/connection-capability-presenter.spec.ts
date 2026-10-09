import { describe, expect, it } from 'vitest';
import type { ConnectionCapability } from '@lazy-armor/plan-schema';
import { capabilityPermission, capabilitySources, capabilityStatus } from './connection-capability-presenter';
const available: ConnectionCapability = { key: 'READ_EVENT', canonicalKey: 'calendar.event.read', name: '读取日程', operation: 'read', sourceModes: ['OFFICIAL_API'], riskLevel: 'R0',
  providerAvailability: 'AVAILABLE', implementation: 'PRODUCTION', grant: 'GRANTED', health: 'HEALTHY', usable: true, reasons: [], dataBoundary: null, verificationMethods: [], explicitDenials: [],
  evidence: { checkedAt: null, validUntil: null, fresh: true, reasonCode: null } };
describe('consumer capability availability wording', () => {
  it('does not call expired evidence or partial authorization available', () => {
    expect(capabilityStatus({ ...available, usable: false, health: 'UNKNOWN', reasons: ['CAPABILITY_HEALTH_EVIDENCE_STALE'] })).toBe('检查已过期');
    expect(capabilityStatus({ ...available, usable: false, grant: 'PARTIAL' })).toBe('权限不完整');
    expect(capabilityStatus({ ...available, usable: false, grant: 'EXPIRED' })).toBe('授权已过期');
  });
  it('keeps implementation and provider availability distinct from connected state', () => {
    expect(capabilityStatus({ ...available, implementation: 'NOT_IMPLEMENTED', usable: false })).toBe('待接入');
    expect(capabilityStatus({ ...available, providerAvailability: 'TO_VERIFY_OFFICIAL', usable: false })).toBe('能力待核实');
    expect(capabilityStatus({ ...available, usable: false, reasons: ['CAPABILITY_EXPLICITLY_DENIED'] })).toBe('不支持此操作');
    expect(capabilityStatus(available)).toBe('可用');
    expect(capabilityStatus({ ...available, implementation: 'BETA' })).toBe('可用 · 试运行');
  });
  it('labels source and grant without leaking diagnostic enum names', () => {
    expect(capabilitySources(['OFFICIAL_API', 'NOTIFICATION', 'unrecognized'])).toBe('官方接口、设备通知');
    expect(capabilityPermission('GRANTED')).toBe('已授权'); expect(capabilityPermission('unrecognized')).toBe('待核对');
    expect(capabilityStatus({ ...available, usable: false, health: 'RATE_LIMITED' })).toBe('来源请求受限');
  });
});
