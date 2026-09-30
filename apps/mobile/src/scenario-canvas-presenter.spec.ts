import { describe, expect, it } from 'vitest';
import { buildScenarioSections, scenarioKeyOf, scenarioStateLabel, TOTAL_SCENARIO_COUNT } from './scenario-canvas-presenter';

describe('scenario canvas presenter', () => {
  it('exposes exactly 96 scenarios across 19 domains', () => {
    expect(TOTAL_SCENARIO_COUNT).toBe(96);
    const sections = buildScenarioSections({ space: 'all', query: '' });
    expect(sections).toHaveLength(19);
    expect(sections.reduce((sum, section) => sum + section.data.length, 0)).toBe(96);
  });

  it('derives scenario state labels from plan counts', () => {
    const row = { key: 'delivery', label: '快递', productDomain: 'daily_life' };
    expect(scenarioStateLabel(row, 0)).toBe('查看状态');
    expect(scenarioStateLabel(row, 1)).toBe('1 个计划');
    expect(scenarioStateLabel(row, 3)).toBe('3 个计划');
  });

  it('keeps scenario keys in the product-domain format the API expects', () => {
    const sections = buildScenarioSections({ space: 'all', query: '' });
    const byLabel = new Map(sections.flatMap((section) => section.data.map((row) => [row.label, row])));
    expect(scenarioKeyOf(byLabel.get('账单')!)).toBe('finance.bill');
    expect(scenarioKeyOf(byLabel.get('快递')!)).toBe('daily_life.delivery');
    expect(scenarioKeyOf(byLabel.get('保养')!)).toBe('vehicle.maintenance');
  });

  it('filters by space', () => {
    const sections = buildScenarioSections({ space: 'property', query: '' });
    expect(sections.map((section) => section.domainKey)).toEqual(['finance', 'housing', 'vehicle', 'device', 'digital_account']);
  });

  it('filters by query across domains', () => {
    const sections = buildScenarioSections({ space: 'all', query: '账单' });
    expect(sections.flatMap((section) => section.data).map((row) => row.label)).toContain('账单');
    expect(sections.every((section) => section.data.every((row) => row.label.includes('账单') || row.key.includes('账单')))).toBe(true);
  });

  it('drops empty sections when a query has no match in a domain', () => {
    const sections = buildScenarioSections({ space: 'all', query: '顺丰' });
    expect(sections).toHaveLength(0);
  });
});
