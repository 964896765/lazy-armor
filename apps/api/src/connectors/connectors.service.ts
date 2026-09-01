import { Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';

@Injectable()
export class ConnectorsService {
  constructor(private readonly registry: ConnectorRegistry) {}

  list() {
    return this.registry.list().map((connector) => ({ ...connector.metadata(), capabilities: connector.capabilities() }));
  }

  get(key: string) {
    try {
      const connector = this.registry.get(key);
      return { ...connector.metadata(), capabilities: connector.capabilities() };
    } catch {
      throw new NotFoundException('Connector not found');
    }
  }
}
