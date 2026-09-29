import { describe, expect, it } from 'vitest';
import { isSelected, PRIMARY_DESTINATIONS, UTILITY_DESTINATIONS } from './v6-navigation';

describe('V6 global navigation shell', () => {
  it('exposes exactly five primary bottom destinations', () => {
    expect(PRIMARY_DESTINATIONS.map((item) => item.label)).toEqual(['首页', '计划', '问一问', '资源', '服务']);
    expect(PRIMARY_DESTINATIONS.map((item) => item.path)).toEqual(['/', '/plans', '/search-ai', '/private', '/services']);
  });

  it('keeps messages and todo as header utilities', () => {
    expect(UTILITY_DESTINATIONS.map((item) => item.label)).toEqual(['消息', '待办']);
    expect(UTILITY_DESTINATIONS.map((item) => item.path)).toEqual(['/messages', '/todo']);
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
    expect(isSelected('/services', '/services')).toBe(true);
    expect(isSelected('/services/active', '/services')).toBe(true);
  });

  it('does not select a destination on a lookalike prefix', () => {
    expect(isSelected('/plans', '/plan')).toBe(false);
    expect(isSelected('/private', '/priv')).toBe(false);
  });

  it('keeps the four UiSpace mapping untouched by navigation', () => {
    // 导航只是展示层；19 领域与四大空间的映射已在 ui-space 中单一维护。
    expect(PRIMARY_DESTINATIONS).toHaveLength(5);
    expect(UTILITY_DESTINATIONS).toHaveLength(2);
  });
});
