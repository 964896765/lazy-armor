import { ConnectorError, type Connector } from '@lazy-armor/connector-sdk';
import { GmailProviderAdapter } from './gmail.adapter';
import { gmailManifest } from './gmail-manifest';

// Never expose the historical isolated Gmail fixture as a live provider.
export class DisabledGmailConnector implements Connector {
  metadata() { return { ...GmailProviderAdapter.prototype.metadata(), productionStatus: 'DISABLED' as const, description: 'Gmail OAuth configuration is missing' }; }
  capabilities() { return gmailManifest.capabilities.map((c) => ({ ...c, providerAvailability: 'disabled' as const, implementationStatus: 'DISABLED' as const })); }
  private deny(): never { throw new ConnectorError('GMAIL_OAUTH_NOT_CONFIGURED', 'AUTH_REQUIRED', 'Gmail OAuth configuration is missing'); }
  async startAuthorization() { return this.deny(); }
  async completeAuthorization() { return this.deny(); }
  async validateConnection() { return this.deny(); }
  async read() { return this.deny(); }
  async execute() { return this.deny(); }
}
