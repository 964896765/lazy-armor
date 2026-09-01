export type CapabilityRisk = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';

export type ProviderType = 'manual' | 'internal' | 'webhook' | 'email' | 'calendar' | 'file' | 'logistics' | 'content';
export type ProviderProductionStatus = 'PRODUCTION_READY' | 'BETA' | 'DRAFT_ONLY' | 'DISABLED';
export type ProviderAuthenticationType = 'none' | 'api_key' | 'oauth2' | 'service_account';
export type ProviderAvailability = 'available' | 'beta' | 'draft_only' | 'disabled';
export type RetrySafety = 'safe' | 'ambiguous' | 'unsafe';
export type ConnectionHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'reauthorization_required' | 'rate_limited' | 'provider_unavailable';
export type ConnectorErrorCategory =
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TIMEOUT'
  | 'OUTCOME_UNKNOWN';

export interface OAuthProviderMetadata {
  authorizationCapability: string;
  supportsRefresh: boolean;
  supportsRevoke: boolean;
  supportsPKCE: boolean;
  requiresRedirect: boolean;
}

export interface ProviderAuthentication {
  type: ProviderAuthenticationType;
  oauth2?: OAuthProviderMetadata;
}

export interface ConnectorMetadata {
  key: string;
  name: string;
  description: string;
  version: string;
  providerType: ProviderType;
  productionStatus: ProviderProductionStatus;
  authentication: ProviderAuthentication;
  supportsRefresh: boolean;
  supportsRevoke: boolean;
  supportsWebhook: boolean;
  supportsHealthCheck: boolean;
  sandboxSupport: 'full' | 'limited' | 'none';
  rateLimitStrategy: 'provider_managed' | 'retry_after' | 'fixed_window' | 'unknown';
}

// Provider 侧副作用能力契约。未声明的字段一律按最保守处理。
export interface SideEffectContract {
  sideEffect: boolean;
  supportsIdempotencyKey: boolean;
  supportsOperationLookup: boolean;
  retrySafety: RetrySafety;
  idempotencyKeyMaxLength?: number;
  idempotencySemantics?: 'header' | 'body' | 'dedupe_window';
}

export interface ConnectorCapability {
  key: string;
  name: string;
  userFacingName?: string;
  riskLevel: CapabilityRisk;
  operation: 'read' | 'execute' | 'subscribe';
  requiredPermission?: string;
  providerAvailability?: ProviderAvailability;
  sideEffectContract?: Partial<SideEffectContract>;
}

export interface ConnectionHealth {
  status: ConnectionHealthStatus;
  checkedAt: string;
  reason?: string;
}

export interface ConnectorCredentialContext {
  ref?: string;
  version?: number;
  data?: Record<string, string>;
  expiresAt?: string | null;
}

export interface ConnectorRequest {
  capability: string;
  input: Record<string, unknown>;
  requestId: string;
  idempotencyKey?: string;
  providerIdempotencyKey?: string;
  operationId?: string;
  userId?: string;
  connectionId?: string;
  connectorKey?: string;
  credentials?: ConnectorCredentialContext;
}

export interface ConnectorResult {
  ok: boolean;
  data: Record<string, unknown>;
}

export interface SubscriptionRequest extends ConnectorRequest {
  callbackUrl?: string;
}

export interface ConnectorErrorOptions {
  retryable?: boolean;
  retryAfterMs?: number;
  providerCode?: string;
  operationState?: 'succeeded' | 'failed' | 'unknown' | 'pending';
}

export class ConnectorError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly providerCode: string | null;
  readonly operationState: 'succeeded' | 'failed' | 'unknown' | 'pending' | null;

  constructor(
    readonly code: string,
    readonly category: ConnectorErrorCategory,
    message: string,
    options?: ConnectorErrorOptions,
  ) {
    super(message);
    this.name = 'ConnectorError';
    this.retryable = options?.retryable ?? false;
    this.retryAfterMs = options?.retryAfterMs ?? null;
    this.providerCode = options?.providerCode ?? null;
    this.operationState = options?.operationState ?? null;
  }
}

export interface AuthorizationStartRequest {
  userId: string;
  state: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface AuthorizationStartResult {
  authorizationUrl: string;
  expiresAt: string;
}

export interface AuthorizationCallbackRequest {
  userId: string;
  state: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface AuthorizationCallbackResult {
  externalAccountName: string;
  credentials: Record<string, string>;
  expiresAt?: string | null;
  grantedCapabilities?: string[];
}

export interface CredentialRefreshRequest {
  credential: Record<string, string>;
}

export interface CredentialRefreshResult {
  credentials: Record<string, string>;
  expiresAt?: string | null;
}

export interface Connector {
  metadata(): ConnectorMetadata;
  capabilities(): ConnectorCapability[];
  validateConnection?(request?: ConnectorRequest): Promise<ConnectionHealth>;
  read?(request: ConnectorRequest): Promise<ConnectorResult>;
  execute?(request: ConnectorRequest): Promise<ConnectorResult>;
  subscribe?(request: SubscriptionRequest): Promise<ConnectorResult>;
  startAuthorization?(request: AuthorizationStartRequest): Promise<AuthorizationStartResult>;
  completeAuthorization?(request: AuthorizationCallbackRequest): Promise<AuthorizationCallbackResult>;
  refreshCredentials?(request: CredentialRefreshRequest): Promise<CredentialRefreshResult>;
  revoke?(): Promise<void>;
}

// 解析 Capability 的副作用契约；对 execute 类且未显式声明的能力采用最保守默认。
export function resolveSideEffectContract(capability: ConnectorCapability): SideEffectContract {
  const declared = capability.sideEffectContract ?? {};
  const isExternal = declared.sideEffect ?? (capability.operation === 'execute' && (capability.riskLevel === 'R3' || capability.riskLevel === 'R4'));
  return {
    sideEffect: isExternal,
    supportsIdempotencyKey: declared.supportsIdempotencyKey ?? false,
    supportsOperationLookup: declared.supportsOperationLookup ?? false,
    retrySafety: declared.retrySafety ?? 'ambiguous',
    idempotencyKeyMaxLength: declared.idempotencyKeyMaxLength ?? 128,
    idempotencySemantics: declared.idempotencySemantics ?? 'header',
  };
}

export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>();

  register(connector: Connector): void {
    const key = connector.metadata().key;
    if (this.connectors.has(key)) throw new Error(`Connector already registered: ${key}`);
    this.connectors.set(key, connector);
  }

  get(key: string): Connector {
    const connector = this.connectors.get(key);
    if (!connector) throw new Error(`Unknown connector: ${key}`);
    return connector;
  }

  list(): Connector[] {
    return [...this.connectors.values()];
  }

  listProviders(): ConnectorMetadata[] {
    return this.list().map((connector) => connector.metadata());
  }

  capabilities(key: string): ConnectorCapability[] {
    return this.get(key).capabilities();
  }

  capability(key: string, capabilityKey: string): ConnectorCapability | undefined {
    return this.get(key).capabilities().find((capability) => capability.key === capabilityKey);
  }

  provider(key: string): ConnectorMetadata {
    return this.get(key).metadata();
  }

  productionStatus(key?: string) {
    if (key) return this.provider(key).productionStatus;
    return this.listProviders().map((provider) => ({ key: provider.key, productionStatus: provider.productionStatus }));
  }

  supportsOperation(key: string, operation: ConnectorCapability['operation']) {
    return this.capabilities(key).some((capability) => capability.operation === operation && capability.providerAvailability !== 'disabled');
  }

  supportsSideEffectRecovery(key: string, capabilityKey?: string) {
    const capabilities = capabilityKey ? this.capabilities(key).filter((capability) => capability.key === capabilityKey) : this.capabilities(key);
    return capabilities.some((capability) => {
      const contract = resolveSideEffectContract(capability);
      return contract.supportsIdempotencyKey || contract.supportsOperationLookup;
    });
  }
}
