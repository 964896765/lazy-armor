import { describe, expect, it } from 'vitest';
import { candidateDedupeKey, parseAndNormalizeObservation, realityValueHash, versionedFactIdentity, type SourceObservationInput } from '../src';
const input: SourceObservationInput = { providerKey: 'github', connectionId: 'connection-1', sourceMode: 'OFFICIAL_API', externalEventKey: 'read-1',
  parserKey: 'generic.repository-resource.v2', resourceHint: 'PullRequest', observedAt: '2026-09-14T00:00:00Z', evidenceHash: 'a'.repeat(64),
  payload: { resourceType: 'PullRequest', resourceId: '100', repositoryId: 42, number: 2, state: 'open', merged: false, updatedAt: '2026-09-13T00:00:00Z' } };
describe('additive versioned resource identity', () => {
  it('retains the exact v1 candidate hash and only namespaces v2', () => {
    const old = parseAndNormalizeObservation({ ...input, parserKey: 'generic.repository-resource.v1' })[0];
    const next = parseAndNormalizeObservation(input)[0];
    expect(candidateDedupeKey('user-1', old)).toBe(realityValueHash({ userId: 'user-1', resourceType: old.resourceType,
      resourceKey: old.resourceKey, subjectKey: old.subjectKey, factKey: old.factKey, valueHash: realityValueHash(old.value) }));
    expect(next.value).toEqual(old.value); // No artificial provider fact or value field.
    expect(candidateDedupeKey('user-1', next)).not.toBe(candidateDedupeKey('user-1', old));
    expect(candidateDedupeKey('user-1', next)).toBe(candidateDedupeKey('user-1', next));
  });
  it('keeps stable fact identity across states while candidate identity changes', () => {
    const open = parseAndNormalizeObservation(input)[0];
    const merged = parseAndNormalizeObservation({ ...input, payload: { ...input.payload, state: 'closed', merged: true, updatedAt: '2026-09-14T00:00:00Z' } })[0];
    expect(versionedFactIdentity('user-1', 'connection-1', open)).toBe(versionedFactIdentity('user-1', 'connection-1', merged));
    expect(candidateDedupeKey('user-1', open)).not.toBe(candidateDedupeKey('user-1', merged));
  });
  it.each(['user', 'connection', 'resource', 'resourceType', 'subject', 'fact'] as const)('isolates %s in the stable identity', (dimension) => {
    const draft = parseAndNormalizeObservation(input)[0];
    expect(versionedFactIdentity(dimension === 'user' ? 'user-2' : 'user-1', dimension === 'connection' ? 'connection-2' : 'connection-1',
      { ...draft, ...(dimension === 'resource' ? { resourceKey: 'other' } : {}), ...(dimension === 'resourceType' ? { resourceType: 'Issue' } : {}), ...(dimension === 'subject' ? { subjectKey: 'other' } : {}),
        ...(dimension === 'fact' ? { factKey: 'issue.state' as const } : {}) })).not.toBe(versionedFactIdentity('user-1', 'connection-1', draft));
  });
  it.each([undefined, 'invalid'])('rejects absent or malformed actual provider update time: %s', (updatedAt) => {
    const payload = { ...input.payload }; if (updatedAt === undefined) delete payload.updatedAt; else payload.updatedAt = updatedAt;
    expect(() => parseAndNormalizeObservation({ ...input, payload })).toThrow();
  });
  it('rejects resource-hint mismatch without changing the v1 parser', () => {
    expect(() => parseAndNormalizeObservation({ ...input, resourceHint: 'Issue' })).toThrow();
    expect(parseAndNormalizeObservation({ ...input, parserKey: 'generic.repository-resource.v1', resourceHint: 'Issue' })).toHaveLength(1);
  });
});
