import { describe, expect, it } from 'vitest';
import { compileScenarioPlan } from '@lazy-armor/plan-schema';
import { requiresServerOwnedTerminalHandoff } from '../src/execution/execution-dispatch.service';

const subjectKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:742:PullRequest:800';
const connectionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('ExecutionDispatch terminal handoff boundary', () => {
  it('rejects the manual-dispatch path for external handoff actions that do not carry a server-owned wakeup proof', () => {
    const compiled = compileScenarioPlan({
      scenarioKey: 'work.tasks',
      scenarioRevision: 3,
      subjectKey,
      target: {
        kind: 'NOTION_UPDATE',
        connectionId,
        action: {
          parent: { type: 'data_source_id', id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
          pageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          properties: { Done: { type: 'checkbox', value: true } },
        },
      },
    });

    expect(requiresServerOwnedTerminalHandoff(compiled.definition.actions)).toBe(true);
    expect(requiresServerOwnedTerminalHandoff([{ config: { handoffTarget: null } }])).toBe(true);
    expect(requiresServerOwnedTerminalHandoff([{ config: { templateKey: 'ordinary-notification' } }])).toBe(false);
  });
});
