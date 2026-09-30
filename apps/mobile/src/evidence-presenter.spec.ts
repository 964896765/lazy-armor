import { describe, expect, it } from 'vitest';
import { evidenceFreshness, evidenceStatusLabel, shortEvidenceHash, sourceModeLabel } from './evidence-presenter';

describe('evidence presenter', () => {
  it('uses consumer labels without upgrading unknown states', () => {
    expect(evidenceStatusLabel('truth_verified')).toBe('已形成可信事实');
    expect(evidenceStatusLabel('unexpected')).toBe('状态未识别');
  });

  it('only marks evidence expired when a validUntil boundary exists', () => {
    expect(evidenceFreshness({ observedAt: '2026-09-20T00:00:00.000Z' }, Date.parse('2026-09-23T00:00:00.000Z'))).toEqual({ label: '未声明有效期', expired: false });
    expect(evidenceFreshness({ observedAt: '2026-09-20T00:00:00.000Z', validUntil: '2026-09-22T00:00:00.000Z' }, Date.parse('2026-09-23T00:00:00.000Z'))).toEqual({ label: '已超过有效期', expired: true });
  });

  it('redacts hashes and translates source modes', () => {
    expect(shortEvidenceHash('a'.repeat(64))).toBe('aaaaaaaaaaaa…aaaaaaaa');
    expect(sourceModeLabel('APP_STRUCTURED_READ')).toBe('受控应用读取');
  });
});
