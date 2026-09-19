import { ConnectorError, type Connector } from '@lazy-armor/connector-sdk';
import { WeComProviderAdapter } from './wecom.adapter';
import { wecomManifest } from './wecom-manifest';
export class DisabledWeComConnector implements Connector {
  metadata() { return { ...WeComProviderAdapter.prototype.metadata(), productionStatus: 'DISABLED' as const, description: 'WeCom app configuration is missing' }; }
  capabilities() { return wecomManifest.capabilities.map((c) => ({ ...c, providerAvailability: 'disabled' as const, implementationStatus: 'DISABLED' as const })); }
  private deny(): never { throw new ConnectorError('WECOM_APP_NOT_CONFIGURED', 'AUTH_REQUIRED', 'WeCom app configuration is missing'); }
  async startAuthorization() { return this.deny(); } async completeAuthorization() { return this.deny(); } async refreshCredentials() { return this.deny(); }
  async revoke() { return this.deny(); } async validateConnection() { return this.deny(); } async read() { return this.deny(); } async execute() { return this.deny(); }
}
