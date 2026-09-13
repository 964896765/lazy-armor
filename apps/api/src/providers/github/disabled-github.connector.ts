import { ConnectorError, type Connector } from '@lazy-armor/connector-sdk';
import { GitHubProviderAdapter } from './github.adapter';
import { githubManifest } from './github-manifest';
export class DisabledGitHubConnector implements Connector {
  metadata() { return { ...GitHubProviderAdapter.prototype.metadata(), productionStatus: 'DISABLED' as const, description: 'GitHub OAuth configuration is missing' }; }
  capabilities() { return githubManifest.capabilities.map((c) => ({ ...c, providerAvailability: 'disabled' as const, implementationStatus: 'DISABLED' as const })); }
  private deny(): never { throw new ConnectorError('GITHUB_OAUTH_NOT_CONFIGURED', 'AUTH_REQUIRED', 'GitHub OAuth configuration is missing'); }
  async startAuthorization() { return this.deny(); } async completeAuthorization() { return this.deny(); }
  async validateConnection() { return this.deny(); } async read() { return this.deny(); } async execute() { return this.deny(); }
}
