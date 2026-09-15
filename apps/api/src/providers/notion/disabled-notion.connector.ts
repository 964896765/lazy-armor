import { ConnectorError, type Connector } from '@lazy-armor/connector-sdk';
import { NotionProviderAdapter } from './notion.adapter'; import { notionManifest } from './notion-manifest';
export class DisabledNotionConnector implements Connector {
  metadata() { return { ...NotionProviderAdapter.prototype.metadata(), productionStatus: 'DISABLED' as const, description: 'Notion OAuth configuration is missing' }; }
  capabilities() { return notionManifest.capabilities.map((c) => ({ ...c, providerAvailability: 'disabled' as const, implementationStatus: 'DISABLED' as const })); }
  private deny(): never { throw new ConnectorError('NOTION_OAUTH_NOT_CONFIGURED', 'AUTH_REQUIRED', 'Notion OAuth configuration is missing'); }
  async startAuthorization() { return this.deny(); } async completeAuthorization() { return this.deny(); } async refreshCredentials() { return this.deny(); }
  async revoke() { return this.deny(); } async validateConnection() { return this.deny(); } async read() { return this.deny(); } async execute() { return this.deny(); }
}
