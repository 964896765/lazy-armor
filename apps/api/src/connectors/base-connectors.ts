import type { Connector, ConnectorCapability, ConnectorMetadata, ConnectorRequest, ConnectorResult, SubscriptionRequest } from '@lazy-armor/connector-sdk';

abstract class BaseConnector implements Connector {
  abstract metadata(): ConnectorMetadata;
  abstract capabilities(): ConnectorCapability[];
  async validateConnection() {
    return { status: 'healthy' as const, checkedAt: new Date().toISOString() };
  }
  async revoke(): Promise<void> {}
}

export class ManualConnector extends BaseConnector {
  metadata = () => ({ key: 'manual', name: '手动输入', description: '由用户手动提供数据', version: '1.0.0' });
  capabilities = (): ConnectorCapability[] => [
    { key: 'MANUAL_INPUT', name: '提交手动输入', riskLevel: 'R0', operation: 'read' },
  ];
  async read(request: ConnectorRequest): Promise<ConnectorResult> {
    return { ok: true, data: { accepted: true, input: request.input, requestId: request.requestId } };
  }
}

export class InternalConnector extends BaseConnector {
  metadata = () => ({ key: 'internal', name: '内部服务', description: '读写懒人装甲内部数据', version: '1.0.0' });
  capabilities = (): ConnectorCapability[] => [
    { key: 'READ_INTERNAL', name: '读取内部数据', riskLevel: 'R0', operation: 'read' },
    { key: 'WRITE_INTERNAL', name: '写入内部数据', riskLevel: 'R1', operation: 'execute' },
  ];
  async read(request: ConnectorRequest): Promise<ConnectorResult> {
    return { ok: true, data: { source: 'internal', input: request.input } };
  }
  async execute(request: ConnectorRequest): Promise<ConnectorResult> {
    return { ok: true, data: { recorded: true, idempotencyKey: request.idempotencyKey ?? null } };
  }
}

export class WebhookConnector extends BaseConnector {
  metadata = () => ({ key: 'webhook', name: 'Webhook', description: '接收标准 Webhook 事件', version: '1.0.0' });
  capabilities = (): ConnectorCapability[] => [
    { key: 'RECEIVE_WEBHOOK', name: '接收 Webhook 事件', riskLevel: 'R0', operation: 'subscribe' },
  ];
  async subscribe(request: SubscriptionRequest): Promise<ConnectorResult> {
    return { ok: true, data: { subscribed: true, callbackUrl: request.callbackUrl ?? null } };
  }
}
