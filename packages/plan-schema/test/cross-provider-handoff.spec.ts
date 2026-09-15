import { describe, expect, it } from 'vitest';
import {
  compileScenarioPlan,
  evaluateConditionAst,
  terminalFollowUpRule,
  terminalTargetContext,
  terminalTargetFromPlanAction,
} from '../src';

const githubSubject = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:742:PullRequest:800';
const gmailSubject = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:message_123';
const notionConnection = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const calendarConnection = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const notionAction = {
  parent: { type: 'data_source_id', id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
  pageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  properties: { Done: { type: 'checkbox', value: true } },
};
const calendarAction = {
  calendarId: 'owner@example.test',
  title: 'Review merged pull request',
  start: { dateTime: '2026-09-16T09:00:00+08:00', timeZone: 'Asia/Shanghai' },
  end: { dateTime: '2026-09-16T10:00:00+08:00', timeZone: 'Asia/Shanghai' },
  attendees: ['reviewer@example.test'],
  sendUpdates: 'all',
};

describe('Batch 9F cross-provider golden handoff contracts', () => {
  it('compiles GitHub to Notion through the ordinary immutable Plan action contract', () => {
    const input = {
      scenarioKey: 'work.tasks',
      scenarioRevision: 3,
      subjectKey: githubSubject,
      target: { kind: 'NOTION_UPDATE' as const, connectionId: notionConnection, action: notionAction },
    };
    const first = compileScenarioPlan(input);
    const replay = compileScenarioPlan(input);
    const targetAction = first.definition.actions[0]!;

    expect(first.runtime).toMatchObject({ strategy: 'SILENT_FOLLOW_UP', actionMode: 'EXECUTE', approvalPolicy: 'ALWAYS_FOR_EXTERNAL', verificationPolicy: 'CALLBACK_OR_READ_BACK' });
    expect(first.runtime.runtimeHash).toBe(replay.runtime.runtimeHash);
    expect(first.definition).toEqual(replay.definition);
    expect(targetAction).toMatchObject({ actionType: 'publish', connectorKey: 'notion', connectionId: notionConnection, requiredCapability: 'UPDATE_PAGE', riskLevel: 'R3' });
    expect(targetAction.config.handoffTarget).toEqual({
      ruleKey: 'github.pull-request.merged.notion-update', ruleRevision: 1, kind: 'NOTION_UPDATE', providerKey: 'notion', capabilityKey: 'UPDATE_PAGE', action: notionAction,
    });
    expect(first.definition.actions[1]).toMatchObject({ actionType: 'record', stepOrder: 1 });
    expect(first.definition.approvalPolicy).toEqual({ type: 'always', config: {} });
  });

  it('compiles Gmail to Calendar with an EXISTS-only deterministic condition', () => {
    const input = {
      scenarioKey: 'work.email',
      scenarioRevision: 2,
      subjectKey: gmailSubject,
      target: { kind: 'CALENDAR_EVENT' as const, connectionId: calendarConnection, action: calendarAction },
    };
    const compiled = compileScenarioPlan(input);
    const action = compiled.definition.actions[0]!;
    const decide = (value: unknown) => evaluateConditionAst(compiled.runtime.conditionAst, {
      evaluatedAt: '2026-09-15T00:00:00.000Z',
      facts: { 'email_message.metadata': { value, truthVersionId: 'truth-email', verifiedAt: '2026-09-15T00:00:00.000Z' } },
    });

    expect(compiled.runtime).toMatchObject({ strategy: 'ASSISTED_ACTION', actionMode: 'PREPARE', approvalPolicy: 'ALWAYS_FOR_EXTERNAL', verificationPolicy: 'CALLBACK_OR_READ_BACK' });
    expect(compiled.definition.conditions).toEqual([{ groupId: 'root', logicalOperator: 'AND', fieldPath: 'email_message.metadata.subject', operator: 'EXISTS', comparisonValue: null, sortOrder: 0 }]);
    expect(action).toMatchObject({ actionType: 'publish', connectorKey: 'google_calendar', connectionId: calendarConnection, requiredCapability: 'CREATE_CALENDAR_EVENT', riskLevel: 'R3' });
    expect(action.config.handoffTarget).toEqual({
      ruleKey: 'gmail.email.calendar-event', ruleRevision: 1, kind: 'CALENDAR_EVENT', providerKey: 'google_calendar', capabilityKey: 'CREATE_CALENDAR_EVENT', action: calendarAction,
    });
    expect(decide('Planning')).toMatchObject({ result: true, truthVersionIds: ['truth-email'] });
    expect(decide('')).toMatchObject({ result: true, truthVersionIds: ['truth-email'] });
    expect(decide(undefined)).toMatchObject({ result: false, truthVersionIds: ['truth-email'] });
  });

  it('derives provider context only from the exact immutable target action', () => {
    const notionRule = terminalFollowUpRule('work.tasks', 3)!;
    const action = compileScenarioPlan({ scenarioKey: 'work.tasks', scenarioRevision: 3, subjectKey: githubSubject,
      target: { kind: 'NOTION_UPDATE', connectionId: notionConnection, action: notionAction } }).definition.actions[0]!;
    const parsed = terminalTargetFromPlanAction(notionRule, {
      connectorKey: action.connectorKey,
      connectionId: action.connectionId,
      requiredCapability: action.requiredCapability,
      configJson: action.config,
    });
    expect(parsed).toEqual({ kind: 'NOTION_UPDATE', connectionId: notionConnection, action: notionAction });
    expect(terminalTargetContext(parsed)).toEqual({ notionAction });
    expect(() => terminalTargetFromPlanAction(notionRule, { connectorKey: 'google_calendar', connectionId: notionConnection,
      requiredCapability: action.requiredCapability, configJson: action.config })).toThrow('unavailable');
    expect(() => terminalTargetFromPlanAction(notionRule, { connectorKey: action.connectorKey, connectionId: calendarConnection,
      requiredCapability: 'CREATE_CALENDAR_EVENT', configJson: action.config })).toThrow('unavailable');
    expect(() => terminalTargetFromPlanAction(notionRule, { connectorKey: action.connectorKey, connectionId: action.connectionId,
      requiredCapability: action.requiredCapability, configJson: { ...action.config, handoffTarget: { ...(action.config.handoffTarget as object), capabilityKey: 'CREATE_CALENDAR_EVENT' } } })).toThrow('invalid');
  });

  it.each([
    ['missing target', { scenarioKey: 'work.tasks', scenarioRevision: 3, subjectKey: githubSubject }],
    ['wrong target kind', { scenarioKey: 'work.tasks', scenarioRevision: 3, subjectKey: githubSubject, target: { kind: 'CALENDAR_EVENT', connectionId: notionConnection, action: calendarAction } }],
    ['malformed Notion update', { scenarioKey: 'work.tasks', scenarioRevision: 3, subjectKey: githubSubject, target: { kind: 'NOTION_UPDATE', connectionId: notionConnection, action: { ...notionAction, pageId: undefined } } }],
    ['malformed Calendar event', { scenarioKey: 'work.email', scenarioRevision: 2, subjectKey: gmailSubject, target: { kind: 'CALENDAR_EVENT', connectionId: calendarConnection, action: { ...calendarAction, end: calendarAction.start } } }],
  ])('fails closed for %s', (_label, input) => {
    expect(() => compileScenarioPlan(input as Parameters<typeof compileScenarioPlan>[0])).toThrow();
  });
});
