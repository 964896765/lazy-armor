import { describe, expect, it, vi } from 'vitest';
import { providerDefinitionHash, validateProviderRuntimePolicy, ProviderRuntimeError } from '@lazy-armor/connector-sdk';
import { parseAndNormalizeObservation } from '@lazy-armor/plan-schema';
import { GMAIL_CALLBACK_PATH } from '@lazy-armor/config';
import { GoogleHttpClient } from '../src/providers/google/google-http.client';
import { GoogleOAuthClient } from '../src/providers/google/google-oauth.client';
import { GmailProviderAdapter } from '../src/providers/gmail/gmail.adapter';
import { gmailManifest, gmailPolicy, gmailEvidence, GMAIL_SCOPES } from '../src/providers/gmail/gmail-manifest';
import { prepareMail, normalizeMessage } from '../src/providers/gmail/gmail-message';
import { ConfigService } from '@nestjs/config';
import { GmailService } from '../src/providers/gmail/gmail.service';
import { createConnectorRegistry } from '../src/connectors/connectors.module';
import { ConnectorsService } from '../src/connectors/connectors.service';

const config = { clientId: 'isolated.apps.googleusercontent.com', clientSecret: 'isolated-secret', redirectUri: 'https://api.example.test' + GMAIL_CALLBACK_PATH };
const credentials = { accessToken: 'isolated-access', refreshToken: 'isolated-refresh', scopes: Object.values(GMAIL_SCOPES).join(' '), emailAddress: 'sender@example.test' };
const request = { capability: 'SEND_EMAIL', requestId: 'isolated', idempotencyKey: 'a'.repeat(64), credentials: { data: credentials },
  input: { context: { email: { from: 'sender@example.test', to: ['recipient@example.test'], subject: '会议确认', body: 'line 1\nline 2' } }, config: { visibility: 'private' } } };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function message(label = 'SENT') {
  const desired = prepareMail(request.input, credentials.emailAddress, request.idempotencyKey);
  return { id: 'message1', threadId: 'thread1', internalDate: String(Date.now()), labelIds: [label],
    payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: desired.from }, { name: 'To', value: desired.to.join(', ') },
      { name: 'Subject', value: `=?UTF-8?B?${Buffer.from(desired.subject).toString('base64')}?=` }, { name: 'Message-ID', value: desired.rfcMessageId }],
    body: { data: Buffer.from(desired.body).toString('base64url') } } };
}
describe('Gmail isolated provider contract (not real account acceptance)', () => {
  it('publishes reviewed capability foundation without secrets while leaving actual Gmail disabled and making no network calls', async () => {
    const runtime = { publish: vi.fn().mockResolvedValue({}) }; const transport = vi.fn();
    const registry = createConnectorRegistry({ NODE_ENV: 'development' });
    const gmail = new GmailService(new ConfigService({ NODE_ENV: 'development' }), registry, runtime as never,
      {} as never, {} as never, {} as never, {} as never, transport);
    await gmail.onModuleInit(); expect(runtime.publish).toHaveBeenCalledWith({ manifest: gmailManifest, evidence: gmailEvidence, policy: gmailPolicy });
    expect(registry.get('gmail').metadata().productionStatus).toBe('DISABLED'); expect(() => gmail.start('owner')).toThrow('GMAIL_OAUTH_NOT_CONFIGURED');
    expect(new ConnectorsService(registry).getPublic('gmail')).toMatchObject({ connectable: false, productionStatus: 'DISABLED' });
    expect(gmail.status()).toMatchObject({ oauthConfigured: false, realAccountAcceptance: 'NOT_VERIFIED' }); expect(transport).not.toHaveBeenCalled();
  });
  it('binds official evidence and all five conservative capability contracts', () => {
    expect(gmailPolicy.evidence.hash).toBe(providerDefinitionHash(gmailEvidence));
    expect(() => validateProviderRuntimePolicy(gmailPolicy, gmailManifest)).not.toThrow();
    expect(gmailManifest.capabilities).toHaveLength(5);
    expect(gmailManifest.capabilities.filter((c) => c.operation === 'execute').every((c) => !c.sideEffectContract.supportsIdempotencyKey && c.sideEffectContract.supportsOperationLookup)).toBe(true);
  });
  it('requires state, exact redirect and S256 PKCE', () => {
    const http = new GoogleHttpClient(vi.fn()); const oauth = new GoogleOAuthClient(config, http, Object.values(GMAIL_SCOPES));
    const input = { userId: 'user', state: 'b'.repeat(48), redirectUri: config.redirectUri, codeVerifier: 'v'.repeat(64) };
    const url = new URL(oauth.start(input).authorizationUrl);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256'); expect(url.searchParams.get('code_challenge')).not.toBe(input.codeVerifier);
    expect(() => oauth.start({ ...input, redirectUri: 'https://evil.test' })).toThrow();
    expect(() => oauth.start({ ...input, codeVerifier: undefined })).toThrow();
  });
  it('exchanges, refreshes and revokes through fixed Google form endpoints without implicit retries', async () => {
    const transport = vi.fn(async (url: string) => url.endsWith('revoke') ? new Response(null, { status: 200 })
      : json({ access_token: 'token', token_type: 'Bearer', expires_in: 3600, scope: credentials.scopes, refresh_token: credentials.refreshToken }));
    const oauth = new GoogleOAuthClient(config, new GoogleHttpClient(transport), Object.values(GMAIL_SCOPES));
    const token = await oauth.exchange({ userId: 'user', state: 'b'.repeat(48), code: 'code', redirectUri: config.redirectUri, codeVerifier: 'v'.repeat(64) });
    await oauth.refresh({ credential: token.credentials }); await oauth.revoke(token.credentials);
    expect(transport.mock.calls).toHaveLength(3); expect(transport.mock.calls.every(([url]) => url.startsWith('https://oauth2.googleapis.com/'))).toBe(true);
  });
  it('submits once and evaluates matching write read-back through the existing Verification policy', async () => {
    const transport = vi.fn(async (_url: string, init: RequestInit) => json(init.method === 'POST' ? { id: 'message1' } : message()));
    const http = new GoogleHttpClient(transport); const adapter = new GmailProviderAdapter(new GoogleOAuthClient(config, http, []), http);
    const result = await adapter.execute(request);
    expect((await adapter.verify({ request, result, policy: gmailPolicy.verificationPolicies[1] })).state).toBe('SUCCEEDED');
    expect(transport.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });
  it('rejects a changed sender before dispatch and treats a missing mutation response ID as possibly effected', async () => {
    const transport = vi.fn(async () => json({})); const http = new GoogleHttpClient(transport);
    const adapter = new GmailProviderAdapter(new GoogleOAuthClient(config, http, []), http);
    await expect(adapter.execute({ ...request, credentials: { data: { ...credentials, emailAddress: 'changed@example.test' } } }))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', phase: 'BEFORE_DISPATCH' });
    expect(transport).not.toHaveBeenCalled();
    await expect(adapter.execute(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', phase: 'AFTER_DISPATCH' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not mistake mismatched content for success', async () => {
    const changed = message(); changed.payload.body.data = Buffer.from('different').toString('base64url');
    const http = new GoogleHttpClient(async (_url, init) => json(init.method === 'POST' ? { id: 'message1' } : changed));
    const adapter = new GmailProviderAdapter(new GoogleOAuthClient(config, http, []), http); const result = await adapter.execute(request);
    expect((await adapter.verify({ request, result, policy: gmailPolicy.verificationPolicies[1] })).state).toBe('OUTCOME_UNKNOWN');
  });
  it('reads metadata, bodies and labels separately and verifies created draft IDs by read-back', async () => {
    const transport = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'POST') return json({ id: 'draft1' });
      if (url.includes('/drafts/draft1')) return json({ id: 'draft1', message: message('DRAFT') });
      if (url.endsWith('/labels')) return json({ labels: [{ id: 'INBOX', name: 'Inbox', type: 'system' }] });
      return json(message());
    });
    const http = new GoogleHttpClient(transport); const adapter = new GmailProviderAdapter(new GoogleOAuthClient(config, http, []), http);
    const metadata = await adapter.read({ ...request, capability: 'READ_EMAIL_METADATA', input: { messageId: 'message1' } });
    expect((metadata.data.messages as Record<string, unknown>[])[0]).not.toHaveProperty('plainText');
    const body = await adapter.read({ ...request, capability: 'READ_EMAIL_BODY', input: { messageId: 'message1' } });
    expect((body.data.messages as Record<string, unknown>[])[0].plainText).toBe('line 1\nline 2');
    expect((await adapter.read({ ...request, capability: 'READ_EMAIL_LABELS', input: {} })).data.labels).toHaveLength(1);
    const draftRequest = { ...request, capability: 'CREATE_EMAIL_DRAFT' }; const draft = await adapter.execute(draftRequest);
    expect(draft.data.draftId).toBe('draft1'); expect((await adapter.verify({ request: draftRequest, result: draft, policy: gmailPolicy.verificationPolicies[0] })).state).toBe('SUCCEEDED');
  });
  it('network loss after possible send performs no retry; reconciliation only reads', async () => {
    let sent = false; const transport = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'POST') { sent = true; throw new TypeError('Socket disconnected'); }
      return json(url.includes('messages?') ? { messages: sent ? [{ id: 'message1' }] : [] } : message());
    });
    const http = new GoogleHttpClient(transport); const adapter = new GmailProviderAdapter(new GoogleOAuthClient(config, http, []), http);
    await expect(adapter.execute(request)).rejects.toMatchObject({ phase: 'AFTER_DISPATCH', code: 'NETWORK_ERROR' });
    const lookup = await adapter.lookupOperation(request);
    expect((lookup.data.verificationEvidence as { matched: boolean }).matched).toBe(true);
    expect(transport.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });
  it('insufficient scopes and header injection fail before dispatch', async () => {
    const transport = vi.fn(); const http = new GoogleHttpClient(transport); const adapter = new GmailProviderAdapter(new GoogleOAuthClient(config, http, []), http);
    await expect(adapter.execute({ ...request, credentials: { data: { ...credentials, scopes: GMAIL_SCOPES.send } } })).rejects.toMatchObject({ code: 'SCOPE_MISSING' });
    expect(() => prepareMail({ context: { email: { to: ['recipient@example.test'], subject: 'x\r\nBcc: evil', body: '' } } }, credentials.emailAddress, request.idempotencyKey)).toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('maps rate limit and rejects non-Google origins without dispatch', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }), { status: 429, headers: { 'retry-after': '5' } }));
    const http = new GoogleHttpClient(transport);
    await expect(http.request('https://gmail.googleapis.com/gmail/v1/users/me/messages')).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 5000 });
    await expect(http.request('https://evil.example.test')).rejects.toBeInstanceOf(ProviderRuntimeError); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('metadata observations cannot manufacture body facts and account identities are isolated', () => {
    const payload = normalizeMessage(message(), false);
    const input = { sourceMode: 'OFFICIAL_API' as const, providerKey: 'gmail', connectionId: 'connection1', externalEventKey: 'event',
      parserKey: 'generic.email-message.v1' as const, resourceHint: 'EmailMessage', payload, evidenceHash: 'f'.repeat(64), observedAt: new Date().toISOString() };
    const facts = parseAndNormalizeObservation(input);
    expect(facts.map((f) => f.factKey)).toEqual(['email_message.metadata', 'email_message.labels']);
    expect(facts[0].subjectKey).not.toBe(parseAndNormalizeObservation({ ...input, connectionId: 'connection2' })[0].subjectKey);
  });
});
