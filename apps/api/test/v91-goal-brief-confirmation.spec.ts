import { describe, expect, it, vi } from 'vitest';
import { consumerConversations, consumerMessages, creationDrafts, planGoalBriefs, planVersions } from '@lazy-armor/database';
import { CreationDraftsService } from '../src/creation-drafts/creation-drafts.service';
import { RequirementsService } from '../src/requirements/requirements.service';

const requirements = new RequirementsService();
const brief = requirements.compile({ goalId: 'conversation', version: 2, messageId: 'message', intent: '评估洗车店商业报告' });
const reference = requirements.reference(brief);

function context(options: { sourceText?: string; conversationVersion?: number; ownedPlan?: boolean; storedBrief?: unknown; state?: string; prior?: Record<string, unknown> } = {}) {
  const draft: Record<string, unknown> = { draftId: 'draft', conversationId: 'conversation', userId: 'owner', state: options.state ?? 'ACTIVE', version: 3,
    proposalMessageId: 'proposal', expiresAt: new Date(Date.now() + 60000), goalBriefJson: options.storedBrief === undefined ? brief : options.storedBrief };
  const rows = new Map<unknown, unknown[]>([
    [creationDrafts, [draft]], [consumerConversations, [{ id: 'conversation', version: options.conversationVersion ?? 2 }]],
    [consumerMessages, [{ id: 'message', content: options.sourceText ?? brief.statement }]],
    [planVersions, options.ownedPlan === false ? [] : [{ id: 'plan-version' }]],
    [planGoalBriefs, options.prior ? [options.prior] : []],
  ]);
  const writes: Array<{ table: unknown; value: Record<string, unknown> }> = [];
  const tx = {
    select: vi.fn(() => {
      let table: unknown;
      const query = { from: (selected: unknown) => { table = selected; return query; },
        where: () => query, innerJoin: () => query,
        for: async () => rows.get(table) ?? [], limit: async () => rows.get(table) ?? [] };
      return query;
    }),
    update: vi.fn((table: unknown) => ({ set: (value: Record<string, unknown>) => ({ where: async () => { writes.push({ table, value }); Object.assign(draft, value); } }) })),
    insert: vi.fn((table: unknown) => ({ values: async (value: Record<string, unknown>) => { writes.push({ table, value }); } })),
  };
  const service = new CreationDraftsService({} as never, {} as never, {} as never);
  return { service, tx: tx as never, writes, draft };
}

describe('V91 confirmation preserves the existing Plan authority', () => {
  it('rejects a changed GoalBrief hash before completing a draft', async () => {
    const { service, tx, writes } = context();
    await expect(service.completeConversation('owner', 'draft', 'proposal', tx, { ...reference, contentHash: '0'.repeat(64) })).rejects.toThrow('CONFIRMATION_CHANGED');
    expect(writes).toEqual([]);
  });
  it('does not allow a new brief to fall back to legacy confirmation', async () => {
    const { service, tx, writes } = context();
    await expect(service.completeConversation('owner', 'draft', 'proposal', tx)).rejects.toThrow('CONFIRMATION_CHANGED');
    expect(writes).toEqual([]);
  });
  it('keeps legacy drafts without GoalBrief on the old confirmation path', async () => {
    const { service, tx, writes } = context({ storedBrief: null });
    await service.completeConversation('owner', 'draft', 'proposal', tx);
    expect(writes).toHaveLength(1);
    expect(writes[0].value.state).toBe('COMPLETED');
  });
  it('source content changes or a newer user turn block confirmation', async () => {
    const changed = context({ sourceText: 'different request' });
    await expect(changed.service.completeConversation('owner', 'draft', 'proposal', changed.tx, reference)).rejects.toThrow('USER_SOURCE_CHANGED');
    expect(changed.writes).toEqual([]);
    const stale = context({ conversationVersion: 3 });
    await expect(stale.service.completeConversation('owner', 'draft', 'proposal', stale.tx, reference)).rejects.toThrow('CONVERSATION_CHANGED');
    expect(stale.writes).toEqual([]);
  });
  it('an inherited report subject must independently retain its actual user-message evidence', async () => {
    const inherited = { ...brief, reportSubject: { kind: 'CAR_WASH_BUSINESS' as const, sourceRefs: [{ kind: 'USER_MESSAGE' as const, id: 'older-message', quote: '荆门洗车店商业报告' }] } };
    const sourceMissing = context({ storedBrief: inherited });
    await expect(sourceMissing.service.completeConversation('owner', 'draft', 'proposal', sourceMissing.tx, requirements.reference(inherited))).rejects.toThrow('USER_SOURCE_CHANGED');
    expect(sourceMissing.writes).toEqual([]);
    expect(requirements.reference(inherited).contentHash).not.toBe(reference.contentHash);
  });
  it('pins exact metadata to an owned existing version and cannot create a Plan itself', async () => {
    const { service, tx, writes } = context({ state: 'COMPLETED' });
    await service.freezeConversationBrief('owner', 'draft', { planId: 'plan', planVersionId: 'plan-version' }, tx, reference);
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe(planGoalBriefs);
    expect(writes[0].value).toMatchObject({ userId: 'owner', planId: 'plan', planVersionId: 'plan-version', briefHash: reference.contentHash, goalBriefJson: brief });
  });
  it('missing owned PlanVersion and mismatched replay identity produce no write', async () => {
    const foreign = context({ state: 'COMPLETED', ownedPlan: false });
    await expect(foreign.service.freezeConversationBrief('owner', 'draft', { planId: 'plan', planVersionId: 'foreign' }, foreign.tx, reference)).rejects.toThrow('NOT_OWNED');
    expect(foreign.writes).toEqual([]);
    const replay = context({ state: 'COMPLETED', prior: { id: 'pin', userId: 'owner', draftId: 'other', planId: 'plan', briefHash: reference.contentHash, goalBriefJson: brief } });
    await expect(replay.service.freezeConversationBrief('owner', 'draft', { planId: 'plan', planVersionId: 'plan-version' }, replay.tx, reference)).rejects.toThrow('CONFIRMATION_CHANGED');
    expect(replay.writes).toEqual([]);
  });
});
