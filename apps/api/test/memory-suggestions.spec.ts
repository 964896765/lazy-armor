import { describe, expect, it } from 'vitest';
import { groundedMemorySuggestions } from '@lazy-armor/plan-schema';
describe('memory extraction is bound to the current user quote', () => {
  it('rejects invented facts, unknown types, oversized lists and unsolicited fields', () => {
    expect(groundedMemorySuggestions('我的相机', [{ type: 'ASSET', title: '相机', quote: '别人的相机' }])).toEqual([]);
    expect(groundedMemorySuggestions('我的相机', [{ type: 'TRUTH', title: '相机', quote: '我的相机' }])).toEqual([]);
    expect(groundedMemorySuggestions('我的相机', [{ type: 'ASSET', title: '相机', quote: '我的相机', authorized: true }])).toEqual([]);
    expect(groundedMemorySuggestions('我的相机', Array(4).fill({ type: 'ASSET', title: '相机', quote: '我的相机' }))).toEqual([]);
  });
  it('deduplicates exact grounded suggestions without rewriting the quoted personal data', () => {
    const suggestion = { type: 'ASSET', title: '相机', quote: '我使用 R10。' };
    expect(groundedMemorySuggestions('帮我记住：我使用 R10。', [suggestion, suggestion])).toEqual([suggestion]);
  });
});
