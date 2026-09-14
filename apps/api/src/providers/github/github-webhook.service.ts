import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorError, ProviderRuntimeError } from '@lazy-armor/connector-sdk';
import { connectionCapabilityGrants, connectionPermissions, connections, connectorCapabilities, connectors, credentialRefs, users, webhookReceipts } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { realityValueHash } from '@lazy-armor/plan-schema';
import { and, asc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../../common/database.module';
import { workerEnabled } from '../../common/app-role';
import { CREDENTIAL_PROVIDER, type CredentialProvider } from '../../credentials/credential-provider';
import { AuditService } from '../../audit/audit.service';
import { GitHubService } from './github.service';
import { gitHubOAuthScopes } from './github-oauth.client';
import { gitHubWebhookHintSchema, parseGitHubWebhookHint } from './github-webhook-hint';

type Receipt = typeof webhookReceipts.$inferSelect;
type Delivery = Parameters<typeof parseGitHubWebhookHint>[0];
const MAX_ATTEMPTS = 6;
@Injectable()
export class GitHubWebhookService implements OnModuleInit, OnApplicationShutdown {
  private readonly secret?: string;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(config: ConfigService, @Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(CREDENTIAL_PROVIDER) private readonly credentials: CredentialProvider,
    private readonly github: GitHubService, private readonly audit: AuditService) {
    const secret = config.get<string>('GITHUB_WEBHOOK_SECRET');
    this.secret = secret && secret.length >= 32 && !/^(?:placeholder|change[-_]?me|example|test[-_]?secret)/i.test(secret) ? secret : undefined;
  }
  configured() { return Boolean(this.secret && this.github.status().oauthConfigured); }
  onModuleInit() {
    if (!this.configured() || process.env.NODE_ENV === 'test' || !workerEnabled('execution-worker')) return;
    this.timer = setInterval(() => { void this.tick().catch(() => undefined); }, 1000);
    this.timer.unref();
  }
  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    // An in-flight read may finish; expired leases are recoverable READs only.
  }
  async receive(connectionId: string, input: Omit<Delivery, 'secret'>) {
    if (!this.configured()) throw new ForbiddenException('GitHub signed ingestion is not configured');
    let parsed;
    try { parsed = parseGitHubWebhookHint({ ...input, secret: this.secret }); }
    catch { throw new ForbiddenException('GitHub signed refresh hint rejected'); }
    const hint = parsed.hint;
    const owned = (await this.db.select({ userId: connections.userId, ref: credentialRefs.ref, version: credentialRefs.currentVersion })
      .from(connections).innerJoin(connectors, eq(connectors.id, connections.connectorId))
      .innerJoin(credentialRefs, eq(credentialRefs.id, connections.credentialRefId))
      .where(and(eq(connections.id, connectionId), eq(connectors.key, 'github'))).limit(1))[0];
    if (!owned) throw new ForbiddenException('GitHub refresh target is not authorized');
    let credential;
    try { credential = await this.credentials.get(owned.ref, owned.version); }
    catch { throw new ForbiddenException('GitHub refresh target is not authorized'); }
    let repositories: unknown;
    try { repositories = JSON.parse(credential.repositories); } catch { repositories = null; }
    if (!credential.accessToken || credential.tokenMode !== 'OAUTH_APP' || !gitHubOAuthScopes(credential.scopes).includes('repo')
      || !Array.isArray(repositories) || repositories.length > 100 || !repositories.some((r) => r?.id === hint.repository.id
        && r.owner?.toLowerCase() === hint.repository.owner.toLowerCase() && r.name?.toLowerCase() === hint.repository.name.toLowerCase())) {
      throw new ForbiddenException('GitHub refresh target is not authorized');
    }
    const idempotencyKey = `github-raw:v1:${parsed.payloadHash}`;
    const existing = async () => (await this.db.select().from(webhookReceipts).where(and(eq(webhookReceipts.connectionId, connectionId),
      or(eq(webhookReceipts.eventId, parsed.deliveryId), eq(webhookReceipts.idempotencyKey, idempotencyKey)))).limit(2));
    const response = (row: Receipt, duplicate: boolean) => {
      if (row.payloadHash !== parsed.payloadHash || row.acquisitionProviderKey !== 'github') throw new ConflictException('GitHub delivery identity conflict');
      return { receiptId: row.id, duplicate, status: row.acquisitionStatus, truthConfirmed: false };
    };
    const replay = (rows: Receipt[]) => {
      // Event identity conflicts win even if a second row already owns this body
      // hash under another delivery. Never rely on unordered OR-query row order.
      const sameDelivery = rows.find((row) => row.eventId === parsed.deliveryId);
      if (sameDelivery && sameDelivery.payloadHash !== parsed.payloadHash) throw new ConflictException('GitHub delivery identity conflict');
      return response(sameDelivery ?? rows[0], true);
    };
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.transaction(async (tx) => {
          const now = new Date();
          const locked = (await tx.select({ status: connections.status, version: credentialRefs.currentVersion, credentialStatus: credentialRefs.status, userStatus: users.status })
            .from(connections).innerJoin(credentialRefs, eq(credentialRefs.id, connections.credentialRefId)).innerJoin(users, eq(users.id, connections.userId))
            .where(and(eq(connections.id, connectionId), eq(connections.userId, owned.userId))).limit(1).for('update'))[0];
          const permission = (await tx.select({ granted: connectionPermissions.granted, revokedAt: connectionPermissions.revokedAt, expiresAt: connectionPermissions.expiresAt, operation: connectorCapabilities.operation })
            .from(connectionPermissions).innerJoin(connectorCapabilities, eq(connectorCapabilities.id, connectionPermissions.connectorCapabilityId))
            .where(and(eq(connectionPermissions.connectionId, connectionId), eq(connectorCapabilities.key, hint.capability))).limit(1).for('update'))[0];
          const grant = (await tx.select().from(connectionCapabilityGrants).where(and(eq(connectionCapabilityGrants.connectionId, connectionId),
            eq(connectionCapabilityGrants.providerKey, 'github'), eq(connectionCapabilityGrants.capabilityKey, hint.capability))).limit(1).for('update'))[0];
          if (!locked || locked.status !== 'connected' || locked.userStatus !== 'active' || locked.credentialStatus !== 'active' || locked.version !== owned.version
            || !permission || permission.operation !== 'read' || permission.granted !== 1 || permission.revokedAt || (permission.expiresAt && permission.expiresAt <= now)
            || !grant || grant.status !== 'GRANTED' || grant.revokedAt || (grant.expiresAt && grant.expiresAt <= now) || !grant.grantedScopesJson.includes('repo')) {
            throw new ForbiddenException('GitHub refresh target is not authorized');
          }
          const prior = await tx.select().from(webhookReceipts).where(and(eq(webhookReceipts.connectionId, connectionId),
            or(eq(webhookReceipts.eventId, parsed.deliveryId), eq(webhookReceipts.idempotencyKey, idempotencyKey)))).limit(2);
          if (prior.length) return replay(prior);
          const receiptId = newId();
          await tx.insert(webhookReceipts).values({ id: receiptId, connectionId, eventId: parsed.deliveryId, requestId: `github-webhook:${newId()}`,
            idempotencyKey, payloadHash: parsed.payloadHash, payload: '{}', payloadSnapshotJson: hint, payloadSizeBytes: parsed.payloadSizeBytes,
            receivedAt: now, expiresAt: new Date(now.getTime() + 600_000), acquisitionProviderKey: 'github', acquisitionStatus: 'PENDING',
            acquisitionAttemptCount: 0, acquisitionNextAttemptAt: now, acquisitionResultJson: { hintHash: realityValueHash(hint) } });
          await this.audit.append({ actorType: 'system', userId: owned.userId, action: 'GITHUB_REFRESH_HINT_ACCEPTED', resourceType: 'webhook_receipt',
            resourceId: receiptId, source: 'api', result: 'unknown', changeSummary: 'Signed identifiers queued for owned REST acquisition; not confirmed Truth' }, tx);
          return { receiptId, duplicate: false, status: 'PENDING', truthConfirmed: false };
        });
      } catch (error) {
        const code = databaseCode(error);
        if (code === 'ER_DUP_ENTRY') { const rows = await existing(); if (rows.length) return replay(rows); }
        if (attempt < 3 && ['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(code)) continue;
        throw error;
      }
    }
  }
  async get(userId: string, id: string) {
    const row = (await this.db.select({ id: webhookReceipts.id, connectionId: webhookReceipts.connectionId, status: webhookReceipts.acquisitionStatus,
      attempts: webhookReceipts.acquisitionAttemptCount, receivedAt: webhookReceipts.receivedAt, expiresAt: webhookReceipts.expiresAt,
      nextAttemptAt: webhookReceipts.acquisitionNextAttemptAt, result: webhookReceipts.acquisitionResultJson })
      .from(webhookReceipts).innerJoin(connections, eq(connections.id, webhookReceipts.connectionId))
      .where(and(eq(webhookReceipts.id, id), eq(connections.userId, userId), eq(webhookReceipts.acquisitionProviderKey, 'github'))).limit(1))[0];
    if (!row) throw new NotFoundException('GitHub refresh receipt not found');
    return row;
  }
  // Optional internal partition permits connection-scoped acquisition/recovery.
  // The background worker always uses the whole durable queue; no public claim API.
  async claim(batch = 4, leaseMs = 45_000, connectionId?: string): Promise<Receipt[]> {
    if (!Number.isInteger(batch) || batch < 1 || batch > 16 || !Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 60_000) throw new Error('Invalid acquisition claim bounds');
    if (!this.configured()) return [];
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx.select().from(webhookReceipts).where(and(eq(webhookReceipts.acquisitionProviderKey, 'github'),
        connectionId ? eq(webhookReceipts.connectionId, connectionId) : undefined,
        or(eq(webhookReceipts.acquisitionStatus, 'PENDING'), eq(webhookReceipts.acquisitionStatus, 'RETRY'), eq(webhookReceipts.acquisitionStatus, 'PROCESSING')),
        lte(webhookReceipts.acquisitionNextAttemptAt, now), or(isNull(webhookReceipts.acquisitionLeaseUntil), lte(webhookReceipts.acquisitionLeaseUntil, now))))
        .orderBy(asc(webhookReceipts.acquisitionNextAttemptAt)).limit(batch).for('update', { skipLocked: true });
      const claimed: Receipt[] = [];
      for (const row of rows) {
        const attempts = row.acquisitionAttemptCount;
        if (!row.expiresAt || row.expiresAt <= now || row.purgedAt || attempts === null || !Number.isSafeInteger(attempts) || attempts < 0 || attempts >= MAX_ATTEMPTS) {
          await tx.update(webhookReceipts).set({ acquisitionStatus: !row.expiresAt || row.expiresAt <= now || row.purgedAt ? 'EXPIRED' : 'FAILED',
            acquisitionLeaseToken: null, acquisitionLeaseUntil: null }).where(eq(webhookReceipts.id, row.id)); continue;
        }
        const leaseToken = newId(); const leaseUntil = new Date(now.getTime() + leaseMs);
        await tx.update(webhookReceipts).set({ acquisitionStatus: 'PROCESSING', acquisitionAttemptCount: attempts + 1,
          acquisitionLeaseToken: leaseToken, acquisitionLeaseUntil: leaseUntil }).where(eq(webhookReceipts.id, row.id));
        claimed.push({ ...row, acquisitionStatus: 'PROCESSING', acquisitionAttemptCount: attempts + 1, acquisitionLeaseToken: leaseToken, acquisitionLeaseUntil: leaseUntil });
      }
      return claimed;
    });
  }
  async process(row: Receipt) {
    if (!row.acquisitionLeaseToken) return;
    const owned = (await this.db.select({ userId: connections.userId, userStatus: users.status }).from(connections)
      .innerJoin(users, eq(users.id, connections.userId)).where(eq(connections.id, row.connectionId)).limit(1))[0];
    if (!owned) return;
    if (owned.userStatus !== 'active') { await this.finish(row, 'BLOCKED', { reasonCode: 'USER_INACTIVE' }); return; }
    const assertLease = async () => {
      const now = new Date();
      const current = (await this.db.select({ id: webhookReceipts.id }).from(webhookReceipts).where(and(eq(webhookReceipts.id, row.id),
        eq(webhookReceipts.connectionId, row.connectionId), eq(webhookReceipts.acquisitionProviderKey, 'github'),
        eq(webhookReceipts.acquisitionStatus, 'PROCESSING'), eq(webhookReceipts.acquisitionLeaseToken, row.acquisitionLeaseToken!),
        gt(webhookReceipts.acquisitionLeaseUntil, now), gt(webhookReceipts.expiresAt, now), isNull(webhookReceipts.purgedAt))).limit(1))[0];
      if (!current) throw new ConflictException('Acquisition lease is no longer current');
    };
    try {
      await assertLease();
      const parsed = gitHubWebhookHintSchema.safeParse(row.payloadSnapshotJson);
      if (!parsed.success || row.acquisitionResultJson?.hintHash !== realityValueHash(parsed.data)) throw new ForbiddenException('Acquisition hint integrity failure');
      if ((row.acquisitionAttemptCount ?? 0) > 1 && ['RATE_LIMITED', 'QUOTA_EXCEEDED', 'NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_UNAVAILABLE'].includes(String(row.acquisitionResultJson?.reasonCode))) {
        await this.github.recoverObservationHealth(owned.userId, row.connectionId);
      }
      const result = await this.github.observeWebhookHint(owned.userId, row.connectionId, parsed.data, assertLease, { receiptId: row.id, leaseToken: row.acquisitionLeaseToken });
      const truths = result.observations.flatMap((observation) => observation.truth);
      const blocked = truths.some((truth) => truth.status !== 'verified');
      await this.finish(row, blocked ? 'BLOCKED' : 'READ_BACK_COMPLETE', { truthRecordIds: truths.map((truth) => truth.id), reasonCode: blocked ? 'TRUTH_BLOCKED' : 'OWNED_API_READ_BACK' });
    } catch (error) {
      const failure = acquisitionFailure(error);
      const retryable = ['RATE_LIMITED', 'QUOTA_EXCEEDED', 'NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_UNAVAILABLE'].includes(failure.code);
      const delay = Math.max(1000 * 2 ** (row.acquisitionAttemptCount ?? 1), failure.retryAfterMs);
      const retry = retryable && (row.acquisitionAttemptCount ?? MAX_ATTEMPTS) < MAX_ATTEMPTS && row.expiresAt && Date.now() + delay < row.expiresAt.getTime();
      await this.finish(row, retry ? 'RETRY' : error instanceof ForbiddenException || error instanceof ConflictException ? 'BLOCKED' : 'FAILED',
        { reasonCode: failure.code }, retry ? new Date(Date.now() + delay) : undefined);
    }
  }
  private async finish(row: Receipt, status: string, result: Record<string, unknown>, nextAttemptAt?: Date) {
    const now = new Date();
    // Stale/restarted workers cannot overwrite a successor's lease or terminal status.
    await this.db.update(webhookReceipts).set({ acquisitionStatus: status, acquisitionResultJson: { ...result, hintHash: row.acquisitionResultJson?.hintHash }, acquisitionLeaseToken: null,
      acquisitionLeaseUntil: null, ...(nextAttemptAt ? { acquisitionNextAttemptAt: nextAttemptAt } : {}) })
      .where(and(eq(webhookReceipts.id, row.id), eq(webhookReceipts.acquisitionStatus, 'PROCESSING'),
        eq(webhookReceipts.acquisitionLeaseToken, row.acquisitionLeaseToken!), gt(webhookReceipts.acquisitionLeaseUntil, now), gt(webhookReceipts.expiresAt, now), isNull(webhookReceipts.purgedAt)));
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try { await Promise.all((await this.claim()).map((row) => this.process(row))); }
    finally { this.running = false; }
  }
}
function acquisitionFailure(error: unknown) {
  if (error instanceof ProviderRuntimeError) return { code: error.code, retryAfterMs: error.retryAfterMs ?? 0 };
  if (error instanceof ConnectorError && error.retryable === true && error.code === 'RATE_LIMITED' && error.category === 'RATE_LIMITED') {
    return { code: 'RATE_LIMITED', retryAfterMs: typeof error.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs) && error.retryAfterMs >= 0 ? error.retryAfterMs : 0 };
  }
  // Shared connection health probes expose the SDK error directly, not an HTTP response.
  if (error instanceof ConnectorError && error.retryable === true && error.providerCode &&
    ['RATE_LIMITED', 'QUOTA_EXCEEDED', 'NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_UNAVAILABLE'].includes(error.providerCode)) {
    return { code: error.providerCode, retryAfterMs: typeof error.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs) && error.retryAfterMs >= 0 ? error.retryAfterMs : 0 };
  }
  if (error instanceof HttpException) {
    const raw = error.getResponse();
    if (raw && typeof raw === 'object') {
      const body = raw as { providerCode?: unknown; code?: unknown; category?: unknown; retryAfterMs?: unknown; retryable?: unknown };
      if (body.retryable === true && body.code === 'RATE_LIMITED' && body.category === 'RATE_LIMITED') {
        return { code: 'RATE_LIMITED', retryAfterMs: typeof body.retryAfterMs === 'number' && Number.isFinite(body.retryAfterMs) && body.retryAfterMs >= 0 ? body.retryAfterMs : 0 };
      }
      if (body.retryable === true && typeof body.providerCode === 'string' && ['RATE_LIMITED', 'QUOTA_EXCEEDED', 'NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_UNAVAILABLE'].includes(body.providerCode)) {
        return { code: body.providerCode, retryAfterMs: typeof body.retryAfterMs === 'number' && Number.isFinite(body.retryAfterMs) && body.retryAfterMs >= 0 ? body.retryAfterMs : 0 };
      }
    }
  }
  return { code: 'ACQUISITION_BLOCKED', retryAfterMs: 0 };
}
function databaseCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const row = current as { code?: string; cause?: unknown }; if (/^ER_[A-Z_]+$/.test(row.code ?? '')) return row.code!; current = row.cause;
  }
  return '';
}
