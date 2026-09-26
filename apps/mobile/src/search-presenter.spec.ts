import { describe, expect, it } from 'vitest';
import {
  buildAiResponse,
  buildSearchSections,
  type PlannerResultLike,
  type SearchResults,
} from './search-presenter';

const results = (overrides: Partial<SearchResults> = {}): SearchResults => ({
  plans: [],
  scenarios: [],
  executions: [],
  notifications: [],
  ...overrides,
});

describe('search presenter', () => {
  it('maps the four search groups to sections with navigation routes', () => {
    const sections = buildSearchSections(results({
      plans: [{ id: 'p1', name: '话费异常守护', description: '话费超过预算提醒', status: 'active' }],
      scenarios: [{ key: 'delivery', domain: 'daily_life', label: '快递' }],
      executions: [{ id: 'e1', planId: 'p1', planName: '话费异常守护', status: 'succeeded', resultSummary: '已检查本月话费', createdAt: '2026-09-26T08:00:00Z' }],
      notifications: [{ id: 'n1', title: '账单提醒', body: '本月话费超过预算', priority: 'P1', status: 'unread', createdAt: '2026-09-26T09:00:00Z' }],
    }));

    expect(sections.map((section) => section.key)).toEqual(['plans', 'scenarios', 'executions', 'notifications']);
    expect(sections[0].title).toBe('我的计划');
    expect(sections[0].rows[0].route).toBe('/plans/p1');
    expect(sections[1].rows[0].route).toBe('/domains/daily_life/delivery');
    expect(sections[2].rows[0].route).toBe('/executions/e1');
    expect(sections[2].rows[0].title).toBe('已检查本月话费');
    expect(sections[3].rows[0].route).toBe('/(tabs)/messages');
  });

  it('drops empty groups and returns no sections for an empty result', () => {
    const sections = buildSearchSections(results({ plans: [{ id: 'p1', name: '计划', description: null, status: 'draft' }] }));
    expect(sections.map((section) => section.key)).toEqual(['plans']);
    expect(buildSearchSections(undefined)).toEqual([]);
    expect(buildSearchSections(results())).toEqual([]);
  });

  it('uses the status label when an execution has no result summary', () => {
    const sections = buildSearchSections(results({
      executions: [{ id: 'e1', planId: 'p1', planName: null, status: 'failed', resultSummary: null, createdAt: '2026-09-26T08:00:00Z' }],
    }));
    expect(sections[0].rows[0].title).toBe('执行失败');
  });
});

describe('search AI response mapping', () => {
  it('shows the explanation for ANSWER', () => {
    const response = buildAiResponse({ result: 'ANSWER', answer: { explanation: '这是回答内容。' } });
    expect(response.kind).toBe('ANSWER');
    expect(response.body).toBe('这是回答内容。');
    expect(response.scenarioKey).toBeNull();
  });

  it('shows the proposal explanation and scenario key for PLAN_DRAFT', () => {
    const response = buildAiResponse({ result: 'PLAN_DRAFT', proposal: { explanation: '识别为设备耗材提醒。', scenarioKey: 'device.consumables' } });
    expect(response.kind).toBe('PLAN_DRAFT');
    expect(response.body).toBe('识别为设备耗材提醒。');
    expect(response.scenarioKey).toBe('device.consumables');
  });

  it('collects missing requirements for CLARIFICATION_REQUIRED', () => {
    const response = buildAiResponse({ result: 'CLARIFICATION_REQUIRED', clarification: { missingRequirements: ['intent_too_vague'] } });
    expect(response.kind).toBe('CLARIFICATION_REQUIRED');
    expect(response.missingRequirements).toEqual(['intent_too_vague']);
    expect(response.body).toBeNull();
  });

  it('falls back to unavailable for unknown or invalid results', () => {
    expect(buildAiResponse({ result: 'PLANNER_OUTPUT_INVALID' }).kind).toBe('UNAVAILABLE');
    expect(buildAiResponse(undefined).kind).toBe('UNAVAILABLE');
    expect(buildAiResponse({ result: 'ANSWER' }).kind).toBe('UNAVAILABLE');
    const unavailable: PlannerResultLike = { result: 'SOMETHING_ELSE' };
    expect(buildAiResponse(unavailable).kind).toBe('UNAVAILABLE');
  });
});
