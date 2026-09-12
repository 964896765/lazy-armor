import { describe, expect, it } from 'vitest';
import { ReconciliationService } from '../src/execution/reconciliation.service';

describe('reconciliation business-result projection', () => {
  async function result(steps: Array<{ id: string; status: string }>, operations: Array<{ id: string; executionStepId: string; status: string }> = [],
    cases: Array<{ operationId: string; status: string; resultState: string }> = []) {
    const values = [[{ id: 'execution', status: 'failed' }], operations, steps, cases];
    const db = { select: () => {
      const value = values.shift()!;
      const builder = { from: () => builder, where: () => builder, limit: async () => value,
        then: (resolve: (rows: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(value).then(resolve, reject) };
      return builder;
    } };
    const service = new ReconciliationService(db as never, null as never, null as never, null as never, null as never, null as never);
    return (await service.executionResult('owner', 'execution')).resultState;
  }

  it('keeps known skipped steps distinct from ambiguous external outcomes', async () => {
    expect(await result([{ id: 'skip', status: 'skipped' }])).toBe('FAILED');
    expect(await result([{ id: 'ok', status: 'succeeded' }, { id: 'skip', status: 'skipped' }])).toBe('PARTIALLY_SUCCEEDED');
  });

  it('includes failed non-external steps instead of treating external success as total success', async () => {
    expect(await result([{ id: 'external', status: 'succeeded' }, { id: 'internal', status: 'failed' }],
      [{ id: 'operation', executionStepId: 'external', status: 'succeeded' }])).toBe('PARTIALLY_SUCCEEDED');
  });

  it('uses resolved cases without rewriting historical operation state', async () => {
    const operation = { id: 'operation', executionStepId: 'external', status: 'outcome_unknown' };
    expect(await result([{ id: 'external', status: 'failed' }], [operation])).toBe('OUTCOME_UNKNOWN');
    expect(await result([{ id: 'external', status: 'failed' }], [operation],
      [{ operationId: 'operation', status: 'RESOLVED', resultState: 'SUCCEEDED' }])).toBe('SUCCEEDED');
    expect(operation.status).toBe('outcome_unknown');
  });
});
