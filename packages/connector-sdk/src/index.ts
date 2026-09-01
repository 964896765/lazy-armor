export type CapabilityRisk = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';

export interface ConnectorMetadata {
  key: string;
  name: string;
  description: string;
  version: string;
}

// Provider 侧副作用能力契约。未声明的字段一律按最保守处理。
export interface SideEffectContract {
  sideEffect: boolean;
  supportsIdempotencyKey: boolean;
  supportsOperationLookup: boolean;
  retrySafety: 'safe' | 'ambiguous' | 'unsafe';
  idempotencyKeyMaxLength?: number;
  idempotencySemantics?: 'header' | 'body' | 'dedupe_window';
}

export interface ConnectorCapability {
  key: string;
  name: string;
  riskLevel: CapabilityRisk;
  operation: 'read' | 'execute' | 'subscribe';
  sideEffectContract?: Partial<SideEffectContract>;
}

export interface ConnectionHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checkedAt: string;
  reason?: string;
}

export interface ConnectorRequest {
  capability: string;
  input: Record<string, unknown>;
  requestId: string;
  idempotencyKey?: string;
  providerIdempotencyKey?: string;
  operationId?: string;
}

export interface ConnectorResult {
  ok: boolean;
  data: Record<string, unknown>;
}

export interface SubscriptionRequest extends ConnectorRequest {
  callbackUrl?: string;
}

export interface Connector {
  metadata(): ConnectorMetadata;
  capabilities(): ConnectorCapability[];
  validateConnection(): Promise<ConnectionHealth>;
  read?(request: ConnectorRequest): Promise<ConnectorResult>;
  execute?(request: ConnectorRequest): Promise<ConnectorResult>;
  subscribe?(request: SubscriptionRequest): Promise<ConnectorResult>;
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

  capabilities(key: string): ConnectorCapability[] {
    return this.get(key).capabilities();
  }

  capability(key: string, capabilityKey: string): ConnectorCapability | undefined {
    return this.get(key).capabilities().find((capability) => capability.key === capabilityKey);
  }
}
