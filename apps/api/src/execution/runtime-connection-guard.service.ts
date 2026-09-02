import { Inject, Injectable } from '@nestjs/common';
import { connectionPermissions, connections, connectorCapabilities, connectors, credentialRefs } from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CREDENTIAL_PROVIDER, CredentialProviderError, type CredentialProvider } from '../credentials/credential-provider';
import { ExecutionRuntimeError } from './execution.types';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';

@Injectable()
export class RuntimeConnectionGuard {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, @Inject(CREDENTIAL_PROVIDER) private readonly credentials: CredentialProvider, private readonly registry: ConnectorRegistry) {}

  async assertUsable(userId: string, connectionId: string, capabilityKey: string) {
    const rows = await this.db.select({
      connectorId: connections.connectorId,
      connectorKey: connectors.key,
      connectionStatus: connections.status,
      connectionExpiresAt: connections.expiresAt,
      credentialRefId: connections.credentialRefId,
      credentialRef: credentialRefs.ref,
      credentialCurrentVersion: credentialRefs.currentVersion,
      credentialStatus: credentialRefs.status,
      credentialExpiresAt: credentialRefs.expiresAt,
      productionStatus: connectors.productionStatus,
    }).from(connections)
      .innerJoin(connectors, eq(connections.connectorId, connectors.id))
      .leftJoin(credentialRefs, eq(connections.credentialRefId, credentialRefs.id))
      .where(and(eq(connections.id, connectionId), eq(connections.userId, userId)))
      .limit(1);
    const connection = rows[0];
    if (!connection) throw new ExecutionRuntimeError('CONNECTION_NOT_OWNED', 'Connection does not belong to this user');
    if (connection.connectionStatus === 'revoked') throw new ExecutionRuntimeError('CONNECTION_REVOKED', 'Connection has been revoked');
    if (connection.connectionExpiresAt && connection.connectionExpiresAt <= new Date()) throw new ExecutionRuntimeError('CONNECTION_EXPIRED', 'Connection has expired');
    if (!['connected', 'degraded'].includes(connection.connectionStatus)) throw new ExecutionRuntimeError('CONNECTION_UNAVAILABLE', 'Connection is unavailable');
    if (connection.credentialRefId && connection.credentialStatus !== 'active') throw new ExecutionRuntimeError('CREDENTIAL_INVALID', 'Credential reference is not active');
    if (connection.credentialExpiresAt && connection.credentialExpiresAt <= new Date()) throw new ExecutionRuntimeError('CREDENTIAL_EXPIRED', 'Credential reference has expired');
    if (connection.credentialRefId && connection.credentialRef && connection.credentialCurrentVersion) {
      try { await this.credentials.get(connection.credentialRef, connection.credentialCurrentVersion); }
      catch (error) {
        if (error instanceof CredentialProviderError && error.retryable) throw new ExecutionRuntimeError('CREDENTIAL_UNAVAILABLE', 'Credential provider is temporarily unavailable', true);
        throw new ExecutionRuntimeError('CREDENTIAL_INVALID', 'Current credential version cannot be resolved');
      }
    }

    const permissions = await this.db.select({
      capabilityId: connectorCapabilities.id,
      granted: connectionPermissions.granted,
      revokedAt: connectionPermissions.revokedAt,
      expiresAt: connectionPermissions.expiresAt,
      operation: connectorCapabilities.operation,
      providerAvailability: connectorCapabilities.providerAvailability,
    }).from(connectorCapabilities)
      .leftJoin(connectionPermissions, and(eq(connectionPermissions.connectorCapabilityId, connectorCapabilities.id), eq(connectionPermissions.connectionId, connectionId)))
      .where(and(eq(connectorCapabilities.connectorId, connection.connectorId), eq(connectorCapabilities.key, capabilityKey)))
      .limit(1);
    const permission = permissions[0];
    if (!permission) throw new ExecutionRuntimeError('CAPABILITY_NOT_FOUND', 'Capability does not belong to the Connector');
    if (permission.revokedAt) throw new ExecutionRuntimeError('PERMISSION_REVOKED', 'Capability permission has been revoked');
    if (permission.expiresAt && permission.expiresAt <= new Date()) throw new ExecutionRuntimeError('PERMISSION_EXPIRED', 'Capability permission has expired');
    if (permission.granted !== 1) throw new ExecutionRuntimeError('CAPABILITY_NOT_GRANTED', 'Capability permission is not granted');
    const adapter = this.registry.get(connection.connectorKey);
    const metadata = adapter.metadata();
    const runtimeCapability = adapter.capabilities().find((item) => item.key === capabilityKey);
    const legacyTestAdapter = process.env.NODE_ENV === 'test' && !metadata.productionStatus;
    if ((!legacyTestAdapter && (!runtimeCapability || metadata.productionStatus === 'DISABLED')) || runtimeCapability?.providerAvailability === 'disabled') {
      throw new ExecutionRuntimeError('PROVIDER_GATE_DISABLED', 'Provider capability is disabled');
    }
    return { connectorId: connection.connectorId, connectorKey: connection.connectorKey, operation: permission.operation };
  }
}
