import { ConnectorError, type Connector } from '@lazy-armor/connector-sdk';
import { DingTalkProviderAdapter } from './dingtalk.adapter';
import { dingtalkManifest } from './dingtalk-manifest';
export class DisabledDingTalkConnector implements Connector {
  metadata() { return { ...DingTalkProviderAdapter.prototype.metadata(), productionStatus: 'DISABLED' as const, description: 'DingTalk app configuration is missing' }; }
  capabilities() { return dingtalkManifest.capabilities.map((c) => ({ ...c, providerAvailability: 'disabled' as const, implementationStatus: 'DISABLED' as const })); }
  private deny(): never { throw new ConnectorError('DINGTALK_APP_NOT_CONFIGURED', 'AUTH_REQUIRED', 'DingTalk app configuration is missing'); }
  async startAuthorization() { return this.deny(); } async completeAuthorization() { return this.deny(); } async refreshCredentials() { return this.deny(); }
  async revoke() { return this.deny(); } async validateConnection() { return this.deny(); } async read() { return this.deny(); } async execute() { return this.deny(); }
}
