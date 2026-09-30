import { describe, expect, it } from 'vitest';
import { isSecondaryWorkspacePath, PRIMARY_ENTRIES, SECONDARY_PAGES } from './information-architecture';

describe('information architecture', () => {
  it('keeps exactly the eight agreed primary entries', () => {
    expect(PRIMARY_ENTRIES.map((entry) => entry.label)).toEqual(['我', '首页', '计划', '资源', '服务', '消息', '问一问', '待办']);
  });

  it('assigns every primary entry a secondary-page catalog', () => {
    expect(Object.keys(SECONDARY_PAGES)).toEqual(PRIMARY_ENTRIES.map((entry) => entry.key));
  });

  it('hides the global shell on tab-backed secondary pages only', () => {
    expect(isSecondaryWorkspacePath('/create')).toBe(true);
    expect(isSecondaryWorkspacePath('/records')).toBe(true);
    expect(isSecondaryWorkspacePath('/connections/abc')).toBe(true);
    expect(isSecondaryWorkspacePath('/plans')).toBe(false);
    expect(isSecondaryWorkspacePath('/messages')).toBe(false);
  });
});
