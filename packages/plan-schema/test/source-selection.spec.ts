import { describe, expect, it } from 'vitest';
import { buildSourceSelection, isSourceSelection } from '../src';

describe('typed Source Selection contract', () => {
  it('keeps provider, device, manual and internal identities mutually explicit', () => {
    expect(buildSourceSelection({ kind: 'PROVIDER_CONNECTION', sourceId: 'connection:c1:READ_X', connectionId: 'c1', capabilityKey: 'READ_X' }))
      .toMatchObject({ kind: 'PROVIDER_CONNECTION', connectionId: 'c1', trustedDeviceId: null, truthRecordId: null });
    expect(buildSourceSelection({ kind: 'TRUSTED_DEVICE', sourceId: 'device-app:a1', trustedDeviceId: 'd1', deviceAppConnectionId: 'a1', capabilityKey: 'READ_X' }))
      .toMatchObject({ kind: 'TRUSTED_DEVICE', trustedDeviceId: 'd1', deviceAppConnectionId: 'a1', connectionId: null });
    expect(buildSourceSelection({ kind: 'MANUAL_INPUT', sourceId: 'manual:t1:v1', truthRecordId: 't1', truthVersionId: 'v1' }))
      .toMatchObject({ kind: 'MANUAL_INPUT', truthRecordId: 't1', truthVersionId: 'v1', connectionId: null });
    expect(buildSourceSelection({ kind: 'INTERNAL_FACT', sourceId: 'internal:t2:v2', truthRecordId: 't2', truthVersionId: 'v2' }))
      .toMatchObject({ kind: 'INTERNAL_FACT', truthRecordId: 't2', truthVersionId: 'v2', connectionId: null });
  });

  it('rejects missing identities and mismatched namespaces', () => {
    expect(() => buildSourceSelection({ kind: 'MANUAL_INPUT', sourceId: 'connection:fake', connectionId: 'fake' })).toThrow();
    expect(() => buildSourceSelection({ kind: 'TRUSTED_DEVICE', sourceId: 'device-app:a1', deviceAppConnectionId: 'a1' })).toThrow();
    expect(() => buildSourceSelection({ kind: 'PROVIDER_CONNECTION', sourceId: 'connection:other:READ_X', connectionId: 'c1', capabilityKey: 'READ_X' })).toThrow();
    expect(() => buildSourceSelection({ kind: 'INTERNAL_FACT', sourceId: 'internal:t1:other', truthRecordId: 't1', truthVersionId: 'v1' })).toThrow();
    expect(isSourceSelection({ schemaVersion: 1, kind: 'INTERNAL_FACT', sourceId: 'internal:t1:v1', truthRecordId: 't1', truthVersionId: 'v1' })).toBe(true);
  });
});
