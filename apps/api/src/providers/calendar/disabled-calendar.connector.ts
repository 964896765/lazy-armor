import { ConnectorError, type Connector } from '@lazy-armor/connector-sdk';
import { GoogleCalendarProviderAdapter } from './calendar.adapter';
import { calendarManifest } from './calendar-manifest';
export class DisabledGoogleCalendarConnector implements Connector {
  metadata() { return { ...GoogleCalendarProviderAdapter.prototype.metadata(), productionStatus: 'DISABLED' as const, description: 'Google Calendar OAuth configuration is missing' }; }
  capabilities() { return calendarManifest.capabilities.map((c) => ({ ...c, providerAvailability: 'disabled' as const, implementationStatus: 'DISABLED' as const })); }
  private deny(): never { throw new ConnectorError('CALENDAR_OAUTH_NOT_CONFIGURED', 'AUTH_REQUIRED', 'Google Calendar OAuth configuration is missing'); }
  async startAuthorization() { return this.deny(); } async completeAuthorization() { return this.deny(); }
  async validateConnection() { return this.deny(); } async read() { return this.deny(); } async execute() { return this.deny(); }
}
