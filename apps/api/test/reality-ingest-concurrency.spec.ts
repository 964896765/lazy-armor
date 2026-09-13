import { ForbiddenException } from '@nestjs/common';
import type { SourceObservationInput } from '@lazy-armor/plan-schema';
import { describe, expect, it, vi } from 'vitest';
import { RealityPipelineService } from '../src/reality-pipeline/reality-pipeline.service';

const input: SourceObservationInput = { sourceMode: 'OFFICIAL_API', providerKey: 'github', connectionId: 'owned-connection',
  parserKey: 'generic.repository-resource.v2', resourceHint: 'PullRequest', externalEventKey: 'immutable-read-identity',
  payload: {}, evidenceHash: 'a'.repeat(64), observedAt: '2026-09-14T00:00:00Z' };
const result = { observationId: 'already-materialized-observation', duplicate: true, candidates: [] };
function setup() {
  const service = new RealityPipelineService(null!, null!, null!, null!);
  const seam = service as unknown as { ingestOnce(userId: string, value: SourceObservationInput): Promise<typeof result> };
  return { service, ingest: vi.spyOn(seam, 'ingestOnce') };
}
describe('local Generic ingestion concurrency boundary; no Provider retry', () => {
  it('reuses exact acquisition identity after nested MySQL deadlock victims', async () => {
    const { service, ingest } = setup();
    ingest.mockRejectedValueOnce({ cause: { code: 'ER_LOCK_DEADLOCK' } }).mockRejectedValueOnce({ cause: { cause: { code: 'ER_LOCK_DEADLOCK' } } }).mockResolvedValue(result);
    expect(await service.ingest('owner', input)).toEqual(result); expect(ingest).toHaveBeenCalledTimes(3);
    for (const call of ingest.mock.calls) { expect(call[0]).toBe('owner'); expect(call[1]).toBe(input); }
  });
  it('bounds retries and propagates the final failure without claiming publication', async () => {
    const { service, ingest } = setup(); const error = { code: 'ER_LOCK_DEADLOCK' }; ingest.mockRejectedValue(error);
    await expect(service.ingest('owner', input)).rejects.toBe(error); expect(ingest).toHaveBeenCalledTimes(4);
  });
  it.each([new ForbiddenException('Permission revoked'), { code: 'ER_LOCK_WAIT_TIMEOUT' }, { code: 'ER_DUP_ENTRY' }, new Error('Parser failure')])('does not retry non-deadlock failure %#', async (error) => {
    const { service, ingest } = setup(); ingest.mockRejectedValue(error);
    await expect(service.ingest('owner', input)).rejects.toBe(error); expect(ingest).toHaveBeenCalledTimes(1);
  });
});
