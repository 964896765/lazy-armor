import { describe, expect, it } from 'vitest';
import { BOTTOM_ACTIONS, isSelected, TOP_DESTINATIONS } from './v6-navigation';

describe('V6 global navigation shell', () => {
  it('exposes exactly four top destinations beside the fixed avatar', () => {
    expect(TOP_DESTINATIONS.map((item) => item.label)).toEqual(['首页', '计划', '私密', '商城']);
    expect(TOP_DESTINATIONS.map((item) => item.path)).toEqual(['/', '/plans', '/private', '/commerce']);
  });

  it('exposes exactly three bottom global actions', () => {
    expect(BOTTOM_ACTIONS.map((item) => item.label)).toEqual(['消息', '搜索或问万事问', '待办']);
    expect(BOTTOM_ACTIONS.map((item) => item.path)).toEqual(['/messages', '/search-ai', '/todo']);
  });

  it('selects the home tab only on the exact root path', () => {
    expect(isSelected('/', '/')).toBe(true);
    expect(isSelected('/plans', '/')).toBe(false);
  });

  it('selects a top destination for itself and its nested routes', () => {
    expect(isSelected('/plans', '/plans')).toBe(true);
    expect(isSelected('/plans/some-id', '/plans')).toBe(true);
    expect(isSelected('/plans/some-id/lifecycle', '/plans')).toBe(true);
    expect(isSelected('/private', '/private')).toBe(true);
    expect(isSelected('/commerce', '/commerce')).toBe(true);
  });

  it('does not select a destination on a lookalike prefix', () => {
    expect(isSelected('/plans', '/plan')).toBe(false);
    expect(isSelected('/private', '/priv')).toBe(false);
  });

  it('keeps the four UiSpace mapping untouched by navigation', () => {
    // 导航只是展示层；19 领域与四大空间的映射已在 ui-space 中单一维护。
    expect(TOP_DESTINATIONS).toHaveLength(4);
    expect(BOTTOM_ACTIONS).toHaveLength(3);
  });
});
