import { describe, expect, it } from 'vitest';
import { compositionResourceSelectionsSchema, compositionReadBindingsSchema } from '../src/composition-resources';
const selection = { methodId: '11111111-1111-4111-8111-111111111111', connectionId: '22222222-2222-4222-8222-222222222222', capabilityKey: 'READ_PUBLIC_WEB_RESEARCH' };
describe('existing public read selection contract', () => {
  it('accepts connection choices and rejects client authority or permission fields', () => {
    expect(compositionResourceSelectionsSchema.safeParse([selection]).success).toBe(true);
    expect(compositionResourceSelectionsSchema.safeParse([{ ...selection, authorityHash: 'a'.repeat(64) }]).success).toBe(false);
    expect(compositionResourceSelectionsSchema.safeParse([{ ...selection, granted: true }]).success).toBe(false);
    expect(compositionResourceSelectionsSchema.safeParse([{ ...selection, capabilityKey: 'calendar.event.create' }]).success).toBe(false);
  });
  it('rejects ambiguity within one method capability and conflicting authority for a shared source', () => {
    expect(compositionResourceSelectionsSchema.safeParse([selection, { ...selection, connectionId: selection.methodId }]).success).toBe(false);
    const binding = { ...selection, authorityHash: 'a'.repeat(64), observedAt: '2026-10-12T00:00:00.000Z' };
    expect(compositionReadBindingsSchema.safeParse([binding, { ...binding, methodId: selection.connectionId, authorityHash: 'b'.repeat(64) }]).success).toBe(false);
  });
});
