import { ConnectorError, type Connector } from '@lazy-armor/connector-sdk';
import { FeishuProviderAdapter } from './feishu.adapter';
import { feishuManifest } from './feishu-manifest';
export class DisabledFeishuConnector implements Connector {
  metadata() { return { ...FeishuProviderAdapter.prototype.metadata(), productionStatus: 'DISABLED' as const, description: 'Feishu/Lark app configuration is missing' }; }
  capabilities() { return feishuManifest.capabilities.map((c) => ({ ...c, providerAvailability: 'disabled' as const, implementationStatus: 'DISABLED' as const })); }
  private deny(): never { throw new ConnectorError('FEISHU_APP_NOT_CONFIGURED', 'AUTH_REQUIRED', 'Feishu/Lark app configuration is missing'); }
  async startAuthorization() { return this.deny(); } async completeAuthorization() { return this.deny(); } async refreshCredentials() { return this.deny(); }
  async revoke() { return this.deny(); } async validateConnection() { return this.deny(); } async read() { return this.deny(); } async execute() { return this.deny(); }
}
