import { describe, expect, it } from 'vitest';
import type { PersonalMemory } from '@lazy-armor/plan-schema/mobile';
import { memoryMutationError, memoryReferenceLabel, memorySourceLabel } from './memory-presenter';
describe('personal memory provenance', () => {
  const memory = { sourceKind: 'USER_INPUT', expiresAt: null } as PersonalMemory;
  it('identifies user-provided information without claiming verification', () => { expect(memorySourceLabel(memory)).toBe('你确认提供 · 个人信息'); });
  it('shows expired information is excluded from subsequent understanding', () => { expect(memorySourceLabel({ ...memory, expiresAt: '2000-01-01T00:00:00Z' })).toBe('你确认提供 · 已过期，不用于理解目标'); });
  it('explains version conflicts and disabled usage without exposing technical codes', () => {
    expect(memoryMutationError({ message: 'MEMORY_VERSION_CHANGED' })).toBe('这条信息已更新，请重新读取后编辑。');
    expect(memoryMutationError({ message: 'MEMORY_USAGE_DISABLED' })).toBe('个人记忆已关闭，请先在个人记忆页开启。');
  });
  it('labels confirmed conversation provenance and makes historical changes explicit', () => {
    expect(memorySourceLabel({ ...memory, sourceKind: 'CONVERSATION_CONFIRMED' })).toBe('来自会话，由你确认 · 个人信息');
    expect(memoryReferenceLabel('CHANGED')).toContain('最新版本');
    expect(memoryReferenceLabel('DELETED')).toContain('不再使用');
  });
});
