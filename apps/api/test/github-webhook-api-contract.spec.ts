import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { GitHubController } from '../src/providers/github/github.controller';
import { GitHubWebhookService } from '../src/providers/github/github-webhook.service';
import type { GitHubService } from '../src/providers/github/github.service';
import type { InjectedDatabase } from '../src/common/database.module';
import type { CredentialProvider } from '../src/credentials/credential-provider';
import type { AuditService } from '../src/audit/audit.service';
import { VersionedResourceTruthService, type ResourceReadProof } from '../src/reality-pipeline/versioned-resource-truth.service';
import type { StrategyRuntimeService } from '../src/strategy-runtime/strategy-runtime.service';

describe('GitHub signed ingestion HTTP and non-Secret fail-closed contracts', () => {
  it.each([null, { receiptId: 'not-a-uuid', leaseToken: 'invalid' }, { receiptId: '11111111-1111-1111-1111-111111111111' }])('rejects malformed internal lease proof before any DB access: %s', async (acquisitionLease) => {
    const db = { select: vi.fn() };
    const service = new VersionedResourceTruthService(db as unknown as InjectedDatabase, {} as AuditService, {} as StrategyRuntimeService);
    await expect(service.confirm('user', 'candidate', { capabilityKey: 'READ_ISSUE', credentialVersion: 1, requestId: 'owned-read',
      acquiredAt: new Date().toISOString(), acquisitionLease } as ResourceReadProof)).rejects.toThrow('server-acquired');
    expect(db.select).not.toHaveBeenCalled();
  });
  it.each([undefined, '', 'short', 'placeholder'.repeat(4)])('never admits a receipt or starts acquisition without usable config: %s', async (secret) => {
    const db = { transaction: vi.fn() };
    const service = new GitHubWebhookService(new ConfigService({ GITHUB_WEBHOOK_SECRET: secret }), db as unknown as InjectedDatabase,
      {} as CredentialProvider, { status: () => ({ oauthConfigured: true }) } as GitHubService, {} as AuditService);
    expect(service.configured()).toBe(false); await expect(service.receive('owned', {})).rejects.toThrow('not configured');
    expect(await service.claim()).toEqual([]); expect(db.transaction).not.toHaveBeenCalled();
  });
  it('does not use signing secret alone as OAuth account authorization', async () => {
    const service = new GitHubWebhookService(new ConfigService({ GITHUB_WEBHOOK_SECRET: 'isolated-signing-secret-at-least-32-bytes' }), {} as InjectedDatabase,
      {} as CredentialProvider, { status: () => ({ oauthConfigured: false }) } as GitHubService, {} as AuditService);
    expect(service.configured()).toBe(false); await expect(service.receive('owned', {})).rejects.toThrow('not configured');
  });
  it.each([{ secure: false, json: true, query: {} }, { secure: true, json: false, query: {} }, { secure: true, json: true, query: { bypass: '1' } }])('rejects insecure/content-type/query bypass before forwarding raw payload: %s', (input) => {
    const webhooks = { receive: vi.fn() }; const controller = new GitHubController({} as GitHubService, webhooks as unknown as GitHubWebhookService);
    expect(() => controller.webhook({ secure: input.secure, is: () => input.json, query: input.query } as unknown as Request, 'owned')).toThrow('HTTPS JSON');
    expect(webhooks.receive).not.toHaveBeenCalled();
  });
  it('forwards only captured raw bytes and GitHub authentication/event headers, not parsed body', () => {
    const webhooks = { receive: vi.fn().mockReturnValue({ status: 'PENDING', truthConfirmed: false }) };
    const controller = new GitHubController({} as GitHubService, webhooks as unknown as GitHubWebhookService);
    const rawBody = Buffer.from('{"exact":true}');
    controller.webhook({ secure: true, is: () => true, query: {}, rawBody, body: { injected: 'not-authority' },
      headers: { 'x-hub-signature-256': 'signature', 'x-github-delivery': 'delivery', 'x-github-event': 'issues' } } as unknown as Request, 'owned');
    expect(webhooks.receive).toHaveBeenCalledExactlyOnceWith('owned', { rawBody, signature: 'signature', deliveryId: 'delivery', event: 'issues' });
  });
});
