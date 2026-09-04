import { describe, expect, it, vi } from 'vitest';
import { SourceResolver } from '../src/execution/source-resolver.service';

function resolverWithTruth() {
  const truthStore = { resolveMobileBillingTransactions: vi.fn(async (_userId: string, context: Record<string, unknown>) => ({ ...context, mobileBillingTransactions: [{ truthRecordId: 'truth-1', amountMinor: 12345, currency: 'CNY', occurredAt: '2026-09-04T00:00:00.000Z', verifiedAt: '2026-09-04T00:01:00.000Z' }], mobileBillingTotalMinor: 12345 })) };
  const passthrough = { enrichContext: (value: Record<string, unknown>) => value };
  const sourceResolver = new SourceResolver(
    {} as never, {} as never, {} as never, passthrough as never, passthrough as never, passthrough as never,
    passthrough as never, passthrough as never, passthrough as never, passthrough as never, passthrough as never,
    passthrough as never, truthStore as never,
  );
  return { sourceResolver, truthStore };
}

describe('truth store plan source', () => {
  it('adds only verified brand-neutral mobile billing facts to a plan execution context', async () => {
    const { sourceResolver, truthStore } = resolverWithTruth();
    const context = await sourceResolver.resolve('user-1', [{ sourceType: 'internal', config: { resource: 'mobile.billing.transaction' }, sortOrder: 0 }] as never, { trigger: 'manual' }, 'request-1');
    expect(truthStore.resolveMobileBillingTransactions).toHaveBeenCalledWith('user-1', { trigger: 'manual' });
    expect(context).toMatchObject({ mobileBillingTotalMinor: 12345, mobileBillingTransactions: [expect.objectContaining({ truthRecordId: 'truth-1', amountMinor: 12345, currency: 'CNY' })] });
    expect(JSON.stringify(context)).not.toMatch(/provider|packageName|notification body/i);
  });
});
