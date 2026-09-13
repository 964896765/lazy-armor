import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyGitHubWebhookSignature } from '../src/providers/github/github-webhook-signature';
const secret = 'isolated-webhook-secret-at-least-32-characters';
const rawBody = Buffer.from('{ "action":"closed", "repository":{"id":42} }');
const signature = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
const input = { secret, rawBody, signature, deliveryId: '51a765ab-19ac-434f-a677-b5fbefc8c3d1' };
describe('GitHub raw-byte signature primitive; not a webhook ingestion endpoint', () => {
  it('authenticates exact request bytes without mutating the body', () => {
    const before = Buffer.from(rawBody); const result = verifyGitHubWebhookSignature(input);
    expect(result.deliveryId).toBe(input.deliveryId); expect(result.payloadHash).toMatch(/^[a-f0-9]{64}$/); expect(rawBody.equals(before)).toBe(true);
  });
  it('rejects a parsed/re-serialized body or a different secret', () => {
    expect(() => verifyGitHubWebhookSignature({ ...input, rawBody: Buffer.from(JSON.stringify(JSON.parse(rawBody.toString()))) })).toThrow();
    expect(() => verifyGitHubWebhookSignature({ ...input, secret: secret + 'wrong' })).toThrow();
  });
  it.each([undefined, '', 'sha1=' + 'a'.repeat(40), 'sha256=ff', 'sha256=' + 'x'.repeat(64), ['sha256=' + 'a'.repeat(64)]])('fails closed on missing or malformed signature %j', (bad) => {
    expect(() => verifyGitHubWebhookSignature({ ...input, signature: bad })).toThrow();
  });
  it.each([undefined, Buffer.alloc(0), Buffer.alloc(1048577)])('rejects unavailable, empty or oversized raw body', (bad) => {
    expect(() => verifyGitHubWebhookSignature({ ...input, rawBody: bad })).toThrow();
  });
  it('requires secret and bounded delivery identifier but never treats that header as signed', () => {
    expect(() => verifyGitHubWebhookSignature({ ...input, secret: undefined })).toThrow();
    expect(() => verifyGitHubWebhookSignature({ ...input, deliveryId: 'untrusted'.repeat(1000) })).toThrow();
    const replay = verifyGitHubWebhookSignature({ ...input, deliveryId: 'c6862daa-19ac-434f-a677-b5fbefc8c3d1' });
    expect(replay.payloadHash).toBe(verifyGitHubWebhookSignature(input).payloadHash);
  });
});
