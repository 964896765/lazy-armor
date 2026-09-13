import { createHash } from 'node:crypto';
import {
  ConnectorError, type AuthorizationCallbackRequest, type AuthorizationCallbackResult,
  type AuthorizationStartRequest, type AuthorizationStartResult, type ConnectionHealth,
  type Connector, type ConnectorMetadata, type ConnectorRequest, type ConnectorResult,
  type CredentialRefreshRequest, type CredentialRefreshResult, type SubscriptionRequest,
} from './index';
import { type ProviderCapabilityManifest, type ReviewStatus, validateProviderCapabilityManifest } from './capability-manifest';

export const PROVIDER_RUNTIME_ERROR_CODES = [
  'AUTH_EXPIRED', 'AUTH_REVOKED', 'SCOPE_MISSING', 'RATE_LIMITED', 'QUOTA_EXCEEDED',
  'PROVIDER_UNAVAILABLE', 'RESOURCE_NOT_FOUND', 'PERMISSION_DENIED', 'NETWORK_ERROR', 'TIMEOUT', 'OUTCOME_UNKNOWN',
] as const;
export type ProviderRuntimeErrorCode = typeof PROVIDER_RUNTIME_ERROR_CODES[number];
export type ProviderOperation = 'read' | 'execute' | 'lookup' | 'health' | 'subscribe';
export type ProviderResultState = 'SUCCEEDED' | 'PARTIALLY_SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';

export interface OfficialEvidenceRevision {
  schemaVersion: '1'; providerKey: string; key: string; revision: number;
  kind: 'OFFICIAL_DOC' | 'MANUAL_REVIEW'; status: ReviewStatus;
  uri: string; summary: string; contentHash: string; reviewedAt: string | null;
}
export interface ProviderRateLimitPolicy { providerRequests: number; connectionRequests: number; windowSeconds: number }
export interface QuotaPolicy { providerUnits: number; connectionUnits: number; windowSeconds: number; capabilityUnits: Record<string, number> }
export interface RetryPolicy {
  maxReadAttempts: number; baseDelayMs: number; maxDelayMs: number;
  writeMode: 'EXISTING_OUTBOX_ONLY'; unknownMode: 'RECONCILE_ONLY';
}
export interface HealthPolicy { validForSeconds: number; timeoutMs: number }
// Structural compatibility with the existing VerificationPolicyRegistry. Read-back
// adapters report through PROVIDER_RESPONSE or the existing read-only OPERATION_LOOKUP.
export interface ProviderVerificationPolicy {
  key: string; revision: string; providerKey: string; capabilityKey: string;
  methods: Array<'PROVIDER_RESPONSE' | 'OPERATION_LOOKUP' | 'USER_CONFIRMATION'>;
  timeoutMs: number; maxAttempts: number; expiresAfterMs: number;
  predicates: Array<{ path: string[]; equals: string | boolean | number; result: Exclude<ProviderResultState, 'OUTCOME_UNKNOWN'> }>;
}
export interface ProviderErrorMapping { providerCode: string; httpStatus?: number; code: ProviderRuntimeErrorCode }
export interface ProviderRuntimePolicy {
  schemaVersion: '1'; providerKey: string; revision: number; manifestRevision: number;
  evidence: { key: string; revision: number; hash: string };
  rateLimit: ProviderRateLimitPolicy; quota: QuotaPolicy; retry: RetryPolicy; health: HealthPolicy;
  verificationPolicies: ProviderVerificationPolicy[]; errorMapping: ProviderErrorMapping[];
}

export type ProviderAuthorizationRequest =
  | { phase: 'START'; request: AuthorizationStartRequest }
  | { phase: 'CALLBACK'; request: AuthorizationCallbackRequest };
export type AuthorizationResult =
  | { phase: 'START'; result: AuthorizationStartResult }
  | { phase: 'CALLBACK'; result: AuthorizationCallbackResult };
export type CredentialResult = CredentialRefreshResult;
export type ProviderHealth = ConnectionHealth;
export type ReadRequest = ConnectorRequest;
export type ReadResult = ConnectorResult;
export type ExecuteRequest = ConnectorRequest;
export type ExecuteResult = ConnectorResult;
export type OperationLookupRequest = ConnectorRequest;
export type OperationLookupResult = ConnectorResult;
export type SubscribeRequest = SubscriptionRequest;
export type SubscriptionResult = ConnectorResult;
export interface VerificationRequest { request: ConnectorRequest; result: ConnectorResult; policy: ProviderVerificationPolicy }
export interface VerificationResult { state: ProviderResultState; method: ProviderVerificationPolicy['methods'][number]; evidence: Record<string, unknown> }

export interface ProviderAdapter {
  metadata(): ConnectorMetadata;
  capabilities(): Connector['capabilities'] extends () => infer T ? T : never;
  authorize(input: ProviderAuthorizationRequest): Promise<AuthorizationResult>;
  refresh(input: CredentialRefreshRequest): Promise<CredentialResult>;
  revoke(input: ConnectorRequest): Promise<void>;
  health(input?: ConnectorRequest): Promise<ProviderHealth>;
  read(input: ReadRequest): Promise<ReadResult>;
  execute(input: ExecuteRequest): Promise<ExecuteResult>;
  lookupOperation?(input: OperationLookupRequest): Promise<OperationLookupResult>;
  subscribe?(input: SubscribeRequest): Promise<SubscriptionResult>;
  verify(input: VerificationRequest): Promise<VerificationResult>;
}

export class ProviderRuntimeError extends Error {
  constructor(readonly code: ProviderRuntimeErrorCode, readonly phase: 'BEFORE_DISPATCH' | 'AFTER_DISPATCH',
    readonly retryAfterMs: number | null = null, readonly definitiveNoEffect = false) {
    super(code); this.name = 'ProviderRuntimeError';
  }
}

// Provider errors remain stable; legacy codes deliberately preserve the mature
// Runner's blocking and ambiguous-outcome classifications rather than replacing it.
export function providerErrorToConnector(error: unknown, operation: ProviderOperation, dispatched: boolean): ConnectorError {
  const source = error instanceof ProviderRuntimeError ? error : new ProviderRuntimeError(
    error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
    dispatched ? 'AFTER_DISPATCH' : 'BEFORE_DISPATCH');
  const uncertainWrite = (operation === 'execute' || operation === 'subscribe') && dispatched
    && source.phase === 'AFTER_DISPATCH' && !source.definitiveNoEffect;
  if (uncertainWrite || source.code === 'OUTCOME_UNKNOWN') {
    return new ConnectorError('NETWORK_ERROR', 'OUTCOME_UNKNOWN', 'Provider outcome requires read-only reconciliation',
      { retryable: false, providerCode: 'OUTCOME_UNKNOWN', operationState: 'unknown' });
  }
  const legacy: Record<ProviderRuntimeErrorCode, [string, ConstructorParameters<typeof ConnectorError>[1]]> = {
    AUTH_EXPIRED: ['CREDENTIAL_EXPIRED', 'AUTH_REQUIRED'], AUTH_REVOKED: ['CONNECTION_REVOKED', 'AUTH_REQUIRED'],
    SCOPE_MISSING: ['PERMISSION_REVOKED', 'PERMISSION_DENIED'], RATE_LIMITED: ['RATE_LIMITED', 'RATE_LIMITED'],
    QUOTA_EXCEEDED: ['QUOTA_EXCEEDED', 'RATE_LIMITED'], PROVIDER_UNAVAILABLE: ['PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'],
    RESOURCE_NOT_FOUND: ['RESOURCE_NOT_FOUND', 'NOT_FOUND'], PERMISSION_DENIED: ['PERMISSION_DENIED', 'PERMISSION_DENIED'],
    NETWORK_ERROR: ['NETWORK_ERROR', 'PROVIDER_UNAVAILABLE'], TIMEOUT: ['TIMEOUT', 'TIMEOUT'], OUTCOME_UNKNOWN: ['NETWORK_ERROR', 'OUTCOME_UNKNOWN'],
  };
  const [code, category] = legacy[source.code];
  const delay = source.retryAfterMs !== null && Number.isFinite(source.retryAfterMs) && source.retryAfterMs > 0
    ? Math.min(Math.ceil(source.retryAfterMs), 86400_000) : undefined;
  return new ConnectorError(code, category, source.code, { providerCode: source.code,
    retryable: operation !== 'execute' && operation !== 'subscribe'
      && ['RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'NETWORK_ERROR', 'TIMEOUT'].includes(source.code), retryAfterMs: delay });
}

function exact(value: object, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error('Invalid provider runtime fields');
}
function bounded(value: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('Invalid bounded provider policy parameter');
}
function identity(value: string) { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(value)) throw new Error('Invalid provider runtime identity'); }
function digest(value: string) { if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid provider evidence digest'); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value);
}
export function providerDefinitionHash(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function validateOfficialEvidenceRevision(evidence: OfficialEvidenceRevision): void {
  exact(evidence, ['schemaVersion', 'providerKey', 'key', 'revision', 'kind', 'status', 'uri', 'summary', 'contentHash', 'reviewedAt']);
  identity(evidence.providerKey); identity(evidence.key); bounded(evidence.revision, 1, 2147483647); digest(evidence.contentHash);
  const uri = new URL(evidence.uri);
  if (evidence.schemaVersion !== '1' || uri.protocol !== 'https:' || uri.username || uri.password || uri.search || uri.hash
    || evidence.uri.length > 1000 || !evidence.summary || evidence.summary.length > 1000
    || !['OFFICIAL_DOC', 'MANUAL_REVIEW'].includes(evidence.kind)
    || !['VERIFIED', 'PENDING_REVIEW', 'NOT_REQUIRED', 'TO_VERIFY_OFFICIAL'].includes(evidence.status)
    || (evidence.status === 'VERIFIED' && (!evidence.reviewedAt || !Number.isFinite(Date.parse(evidence.reviewedAt))))
    || (evidence.kind === 'OFFICIAL_DOC' && evidence.status === 'NOT_REQUIRED')) throw new Error('Invalid official evidence revision');
}
export function validateProviderRuntimePolicy(policy: ProviderRuntimePolicy, manifest: ProviderCapabilityManifest): void {
  exact(policy, ['schemaVersion', 'providerKey', 'revision', 'manifestRevision', 'evidence', 'rateLimit', 'quota', 'retry', 'health', 'verificationPolicies', 'errorMapping']);
  identity(policy.providerKey); bounded(policy.revision, 1, 2147483647); bounded(policy.manifestRevision, 1, 2147483647);
  if (policy.schemaVersion !== '1' || policy.providerKey !== manifest.providerKey || policy.manifestRevision !== manifest.revision) throw new Error('Provider policy manifest mismatch');
  exact(policy.evidence, ['key', 'revision', 'hash']); identity(policy.evidence.key); bounded(policy.evidence.revision, 1, 2147483647); digest(policy.evidence.hash);
  exact(policy.rateLimit, ['providerRequests', 'connectionRequests', 'windowSeconds']);
  bounded(policy.rateLimit.providerRequests, 1, 100_000_000); bounded(policy.rateLimit.connectionRequests, 1, 100_000_000); bounded(policy.rateLimit.windowSeconds, 1, 86400);
  exact(policy.quota, ['providerUnits', 'connectionUnits', 'windowSeconds', 'capabilityUnits']);
  bounded(policy.quota.providerUnits, 1, 100_000_000); bounded(policy.quota.connectionUnits, 1, 100_000_000); bounded(policy.quota.windowSeconds, 1, 31 * 86400);
  const capabilities = new Map(manifest.capabilities.map((item) => [item.key, item]));
  if (!policy.quota.capabilityUnits || typeof policy.quota.capabilityUnits !== 'object' || Array.isArray(policy.quota.capabilityUnits)) throw new Error('Invalid quota capability units');
  for (const [key, units] of Object.entries(policy.quota.capabilityUnits)) { if (!capabilities.has(key)) throw new Error('Unknown quota capability'); bounded(units, 1, 100_000_000); }
  exact(policy.retry, ['maxReadAttempts', 'baseDelayMs', 'maxDelayMs', 'writeMode', 'unknownMode']);
  bounded(policy.retry.maxReadAttempts, 1, 20); bounded(policy.retry.baseDelayMs, 1, 30_000); bounded(policy.retry.maxDelayMs, 1, 30_000);
  if (policy.retry.baseDelayMs > policy.retry.maxDelayMs || policy.retry.writeMode !== 'EXISTING_OUTBOX_ONLY' || policy.retry.unknownMode !== 'RECONCILE_ONLY') throw new Error('Unsafe provider retry policy');
  exact(policy.health, ['validForSeconds', 'timeoutMs']); bounded(policy.health.validForSeconds, 1, 86400); bounded(policy.health.timeoutMs, 1, 30_000);
  if (!Array.isArray(policy.verificationPolicies) || !Array.isArray(policy.errorMapping)) throw new Error('Invalid provider policy registries');
  const bindings = new Set<string>();
  for (const verification of policy.verificationPolicies) {
    exact(verification, ['key', 'revision', 'providerKey', 'capabilityKey', 'methods', 'timeoutMs', 'maxAttempts', 'expiresAfterMs', 'predicates']);
    identity(verification.key); identity(verification.revision);
    if (verification.providerKey !== policy.providerKey || !capabilities.has(verification.capabilityKey) || bindings.has(verification.capabilityKey)) throw new Error('Invalid verification binding');
    bindings.add(verification.capabilityKey); bounded(verification.timeoutMs, 1, 30_000); bounded(verification.maxAttempts, 1, 20); bounded(verification.expiresAfterMs, 1, 7 * 86400_000);
    if (!verification.methods.length || verification.methods.some((method) => !['PROVIDER_RESPONSE', 'OPERATION_LOOKUP', 'USER_CONFIRMATION'].includes(method))) throw new Error('Invalid verification method');
    for (const predicate of verification.predicates) {
      exact(predicate, ['path', 'equals', 'result']);
      if (!predicate.path.length || predicate.path.length > 8 || predicate.path.some((part) => !part || ['__proto__', 'prototype', 'constructor'].includes(part))
        || !['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED'].includes(predicate.result)
        || !['string', 'boolean', 'number'].includes(typeof predicate.equals) || (typeof predicate.equals === 'number' && !Number.isFinite(predicate.equals))) throw new Error('Invalid verification predicate');
    }
  }
  for (const capability of manifest.capabilities) {
    if (!Object.hasOwn(policy.quota.capabilityUnits, capability.key)) throw new Error('Missing capability quota cost');
    if (capability.sideEffectContract.sideEffect && (!bindings.has(capability.key) || capability.sideEffectContract.retrySafety !== 'unsafe')) {
      // First real-provider wave deliberately does not promise provider idempotency.
      throw new Error('Side effects require explicit verification and conservative retry safety');
    }
  }
  const mappings = new Set<string>();
  for (const mapping of policy.errorMapping) {
    exact(mapping, ['providerCode', 'httpStatus', 'code']); identity(mapping.providerCode);
    if (!PROVIDER_RUNTIME_ERROR_CODES.includes(mapping.code)) throw new Error('Invalid provider error code');
    if (mapping.httpStatus !== undefined) bounded(mapping.httpStatus, 400, 599);
    const key = mapping.providerCode + ':' + (mapping.httpStatus ?? '*');
    if (mappings.has(key)) throw new Error('Ambiguous provider error mapping'); mappings.add(key);
  }
}
export function mapProviderFailure(policy: ProviderRuntimePolicy, input: { providerCode?: string; httpStatus?: number; phase: ProviderRuntimeError['phase']; definitiveNoEffect?: boolean; retryAfterMs?: number }): ProviderRuntimeError {
  const match = policy.errorMapping.find((mapping) => mapping.providerCode === input.providerCode && mapping.httpStatus === input.httpStatus)
    ?? policy.errorMapping.find((mapping) => mapping.providerCode === input.providerCode && mapping.httpStatus === undefined);
  const code = match?.code ?? (input.httpStatus === 401 ? 'AUTH_EXPIRED' : input.httpStatus === 403 ? 'PERMISSION_DENIED'
    : input.httpStatus === 404 ? 'RESOURCE_NOT_FOUND' : input.httpStatus === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE');
  return new ProviderRuntimeError(code, input.phase, input.retryAfterMs ?? null, input.definitiveNoEffect ?? false);
}

export interface ProviderRuntimeHost {
  assertPolicyActive(policy: ProviderRuntimePolicy): Promise<unknown>;
  beforeOperation(policy: ProviderRuntimePolicy, request: ConnectorRequest, operation: ProviderOperation): Promise<void>;
  verifyEvidence(policy: ProviderVerificationPolicy, result: VerificationResult): ProviderResultState;
  resolveCredential?(request: ConnectorRequest): Promise<Record<string, string>>;
  recordHealth?(policy: ProviderRuntimePolicy, request: ConnectorRequest, health: ProviderHealth): Promise<void>;
}

export class ProviderConnectorBridge implements Connector {
  private readonly definition: ProviderRuntimePolicy;
  get policy() { return structuredClone(this.definition); }
  private readonly manifest: ReturnType<typeof validateProviderCapabilityManifest>;
  readonly lookupOperation?: (request: ConnectorRequest) => Promise<ConnectorResult>;
  readonly subscribe?: (request: SubscriptionRequest) => Promise<ConnectorResult>;
  constructor(private readonly adapter: ProviderAdapter, manifest: ProviderCapabilityManifest,
    policy: ProviderRuntimePolicy, private readonly host: ProviderRuntimeHost) {
    const { manifestHash, ...rawManifest } = manifest as ProviderCapabilityManifest & { manifestHash?: string };
    this.manifest = validateProviderCapabilityManifest(structuredClone(rawManifest));
    if (manifestHash && manifestHash !== this.manifest.manifestHash) throw new Error('Provider manifest hash mismatch');
    validateProviderRuntimePolicy(policy, this.manifest); this.definition = structuredClone(policy);
    if (adapter.metadata().key !== manifest.providerKey || adapter.capabilities().some((cap) => !manifest.capabilities.some((item) => item.key === cap.key))) throw new Error('Provider adapter manifest mismatch');
    if (manifest.capabilities.some((cap) => ['BETA', 'PRODUCTION'].includes(cap.implementationStatus)
      && !adapter.capabilities().some((item) => item.key === cap.key && item.operation === cap.operation))) throw new Error('Provider implementation handler mismatch');
    if (adapter.lookupOperation) this.lookupOperation = (request) => this.call('lookup', request, (prepared) => adapter.lookupOperation!(prepared));
    if (adapter.subscribe) this.subscribe = (request) => this.call('subscribe', request, (prepared) => adapter.subscribe!(prepared));
  }
  metadata() { return structuredClone(this.adapter.metadata()); }
  capabilities() { return structuredClone(this.manifest.capabilities); }
  read(request: ConnectorRequest) { return this.call('read', request, (prepared) => this.adapter.read(prepared)); }
  execute(request: ConnectorRequest) {
    return this.call('execute', request, async (prepared) => {
      const result = await this.adapter.execute(prepared);
      const policy = this.policy.verificationPolicies.find((item) => item.capabilityKey === prepared.capability);
      if (!policy) throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
      let timer: ReturnType<typeof setTimeout> | undefined;
      let verified: VerificationResult;
      try {
        // Only the read-only verification is bounded here, never execute itself.
        verified = await Promise.race([this.adapter.verify({ request: prepared, result, policy: structuredClone(policy) }), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH')), policy.timeoutMs);
        })]);
      } finally { if (timer) clearTimeout(timer); }
      const conclusion = this.host.verifyEvidence(structuredClone(policy), verified);
      if (conclusion === 'FAILED') return { ok: false, data: verified.evidence };
      if (!result.ok || conclusion !== 'SUCCEEDED') throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH');
      return { ok: true, data: { ...result.data, verification: verified } };
    });
  }
  async validateConnection(request?: ConnectorRequest) {
    if (!request) throw new ConnectorError('AUTH_REQUIRED', 'AUTH_REQUIRED', 'Connection context is required');
    return this.call('health', request, async (prepared) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Health is read-only. A timed-out probe cannot redispatch an action.
        const health = await Promise.race([this.adapter.health(prepared), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ProviderRuntimeError('TIMEOUT', 'AFTER_DISPATCH')), this.definition.health.timeoutMs);
        })]);
        await this.host.recordHealth?.(this.policy, prepared, health);
        return { ...health, validUntil: new Date(Date.now() + this.definition.health.validForSeconds * 1000).toISOString() };
      } finally { if (timer) clearTimeout(timer); }
    });
  }
  async startAuthorization(request: AuthorizationStartRequest) {
    try {
      await this.host.assertPolicyActive(this.policy);
      const result = await this.adapter.authorize({ phase: 'START', request });
      if (result.phase !== 'START') throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); return result.result;
    } catch (error) { throw providerErrorToConnector(error, 'health', false); }
  }
  async completeAuthorization(request: AuthorizationCallbackRequest) {
    try {
      await this.host.assertPolicyActive(this.policy);
      const result = await this.adapter.authorize({ phase: 'CALLBACK', request });
      if (result.phase !== 'CALLBACK' || result.result.grantedCapabilities?.some((key) => !this.manifest.capabilities.some((cap) => cap.key === key))) throw new ProviderRuntimeError('SCOPE_MISSING', 'BEFORE_DISPATCH');
      return result.result;
    } catch (error) { throw providerErrorToConnector(error, 'health', false); }
  }
  async refreshCredentials(request: CredentialRefreshRequest) {
    try { await this.host.assertPolicyActive(this.policy); return await this.adapter.refresh(request); } catch (error) { throw providerErrorToConnector(error, 'health', false); }
  }
  async revoke(request?: ConnectorRequest) {
    if (!request?.userId || !request.connectionId) throw new ConnectorError('PERMISSION_DENIED', 'PERMISSION_DENIED', 'Connection-scoped revocation is required');
    try { const prepared = await this.prepareCredential(request); await this.adapter.revoke(prepared); }
    catch (error) { throw providerErrorToConnector(error, 'health', false); }
  }
  private async prepareCredential(request: ConnectorRequest) {
    const data = this.host.resolveCredential ? await this.host.resolveCredential(request) : request.credentials?.data;
    return { ...request, credentials: { ...request.credentials, data } };
  }
  private async call<T>(operation: ProviderOperation, request: ConnectorRequest, invoke: (prepared: ConnectorRequest) => Promise<T>): Promise<T> {
    const attempts = operation === 'execute' || operation === 'subscribe' ? 1 : this.definition.retry.maxReadAttempts;
    for (let attempt = 1; ; attempt++) {
      try { return await this.callOnce(operation, request, invoke); }
      catch (error) {
        if (attempt >= attempts || !(error instanceof ConnectorError) || !error.retryable
          || (error.retryAfterMs ?? 0) > this.definition.retry.maxDelayMs) throw error;
        const delay = Math.max(error.retryAfterMs ?? 0, Math.min(this.definition.retry.maxDelayMs, this.definition.retry.baseDelayMs * 2 ** (attempt - 1)));
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  private async callOnce<T>(operation: ProviderOperation, request: ConnectorRequest, invoke: (prepared: ConnectorRequest) => Promise<T>): Promise<T> {
    let dispatched = false;
    try {
      const capability = this.manifest.capabilities.find((item) => item.key === request.capability);
      if (operation !== 'health' && (!['VERIFIED', 'NOT_REQUIRED'].includes(this.manifest.providerReview) || this.manifest.explicitDenials.length || capability?.explicitDenials.length)) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'BEFORE_DISPATCH');
      if (operation !== 'health' && (!capability || capability.officialAvailability !== 'AVAILABLE'
        || !['BETA', 'PRODUCTION'].includes(capability.implementationStatus)
        || !['VERIFIED', 'NOT_REQUIRED'].includes(capability.reviewStatus))) throw new ProviderRuntimeError('PROVIDER_UNAVAILABLE', 'BEFORE_DISPATCH');
      if ((operation === 'read' || operation === 'execute' || operation === 'subscribe') && capability?.operation !== operation) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
      if ((operation === 'execute' || operation === 'subscribe') && (!request.userId || !request.connectionId || !request.idempotencyKey)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
      if (operation === 'lookup' && !capability?.sideEffectContract.supportsOperationLookup) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
      await this.host.beforeOperation(structuredClone(this.policy), request, operation);
      const prepared = await this.prepareCredential(request);
      if (this.metadata().authentication.type === 'oauth2') {
        const credential = prepared.credentials.data;
        if (!credential?.accessToken) throw new ProviderRuntimeError('AUTH_EXPIRED', 'BEFORE_DISPATCH');
        const expiresAt = prepared.credentials.expiresAt ?? credential.expiresAt;
        if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) throw new ProviderRuntimeError('AUTH_EXPIRED', 'BEFORE_DISPATCH');
        const scopes = new Set((credential.scopes ?? '').split(/\s+/).filter(Boolean));
        if (capability?.oauthScopes.some((scope) => !scopes.has(scope))) throw new ProviderRuntimeError('SCOPE_MISSING', 'BEFORE_DISPATCH');
      }
      // Exactly one adapter invocation. Never add Promise.race around a write or
      // retry an unconfirmed dispatch; the provider transport must abort its own I/O.
      dispatched = true; return await invoke(prepared);
    } catch (error) { throw providerErrorToConnector(error, operation, dispatched); }
  }
}
