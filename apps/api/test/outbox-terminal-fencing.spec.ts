import { describe, expect, it, vi } from 'vitest';
import { OutboxWorker } from '../src/execution/side-effect/outbox-worker.service';
import { ExecutionRuntimeError } from '../src/execution/execution.types';

describe('outbox terminal-outcome fencing', () => {
  function fixture(status: string) {
    const mark = vi.fn(); const recordResponse = vi.fn(); const append = vi.fn(); const emit = vi.fn();
    const query = { from: () => query, where: () => query, limit: () => query, for: async () => [{ status }] };
    const tx = { select: () => query };
    const worker = Object.assign(Object.create(OutboxWorker.prototype), { db: { transaction: (work: (executor: unknown) => unknown) => work(tx) },
      operations: { mark }, verification: { recordResponse }, events: { append }, notifications: { emit } });
    return { worker, mark, recordResponse, append, emit };
  }

  it('does not replace a committed terminal result with a stale unknown callback', async () => {
    for (const status of ['succeeded', 'failed', 'cancelled', 'outcome_unknown']) {
      const input = fixture(status);
      await input.worker.unknownOutcome({ id: 'operation' }, {}, new ExecutionRuntimeError('NETWORK_ERROR', 'late callback'), 'execution');
      expect(input.mark).not.toHaveBeenCalled(); expect(input.append).not.toHaveBeenCalled(); expect(input.emit).not.toHaveBeenCalled();
    }
  });

  it('does not replace known terminal results with a stale failure callback', async () => {
    for (const status of ['succeeded', 'failed', 'cancelled']) {
      const input = fixture(status);
      await input.worker.failOperation({ id: 'operation' }, {}, 'PROVIDER_REJECTED', 'late callback');
      expect(input.mark).not.toHaveBeenCalled(); expect(input.append).not.toHaveBeenCalled();
    }
  });

  it('appends late failure evidence but preserves the original unknown operation', async () => {
    const input = fixture('outcome_unknown');
    await input.worker.failOperation({ id: 'operation' }, {}, 'PROVIDER_REJECTED', 'late callback');
    expect(input.recordResponse).toHaveBeenCalledOnce(); expect(input.mark).not.toHaveBeenCalled(); expect(input.append).not.toHaveBeenCalled();
  });
});
