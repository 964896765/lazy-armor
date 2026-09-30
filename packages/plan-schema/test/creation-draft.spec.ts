import { describe, expect, it } from 'vitest';
import {
  CREATION_DRAFT_STAGES,
  CREATION_DRAFT_STATES,
  creationDraftInputSchema,
  type CreationDraftInput,
} from '../src/creation-draft';

const base = (): CreationDraftInput => ({
  scenarioKey: 'daily_life.delivery',
  scenarioRevision: 2,
  stage: 1,
  goal: { intent: 'NOTIFY_ON_DELIVERY_CHANGE', description: '物流变化时提醒', constraints: {} },
  subject: null,
});

describe('CreationDraft contract', () => {
  it('accepts a stage-1 goal-only draft', () => {
    const parsed = creationDraftInputSchema.parse(base());
    expect(parsed.scenarioKey).toBe('daily_life.delivery');
    expect(parsed.stage).toBe(1);
    expect(parsed.subject).toBeNull();
  });

  it('accepts a stage-4 draft with subject, source choices and selected offer', () => {
    const parsed = creationDraftInputSchema.parse({
      ...base(),
      stage: 4,
      subject: { resourceType: 'shipment', subjectKey: 'shipment:abc', displayName: '我的包裹' },
      sourceChoices: [{ demandId: 'fd_abc123', sourceId: 'connection:c1:READ_SHIPMENT' }],
      selectedOfferKey: 'po_abc123',
    });
    expect(parsed.stage).toBe(4);
    expect(parsed.subject?.resourceType).toBe('shipment');
    expect(parsed.sourceChoices).toHaveLength(1);
    expect(parsed.selectedOfferKey).toBe('po_abc123');
  });

  it('rejects an out-of-range stage', () => {
    const result = creationDraftInputSchema.safeParse({ ...base(), stage: 6 });
    expect(result.success).toBe(false);
  });

  it('rejects a missing scenario key', () => {
    const result = creationDraftInputSchema.safeParse({ ...base(), scenarioKey: '' });
    expect(result.success).toBe(false);
  });

  it('defines the five-stage wizard and terminal draft states', () => {
    expect(CREATION_DRAFT_STAGES).toEqual([1, 2, 3, 4, 5]);
    expect(CREATION_DRAFT_STATES).toContain('ACTIVE');
    expect(CREATION_DRAFT_STATES).toContain('COMPLETED');
    expect(CREATION_DRAFT_STATES).toContain('DISCARDED');
    expect(CREATION_DRAFT_STATES).toContain('EXPIRED');
  });
});
