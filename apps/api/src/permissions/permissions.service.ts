import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { connectionPermissions, connections, connectorCapabilities, connectors } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import type { PermissionUpdateDto } from '../connections/dto';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { TRUE_PROCESS_HARNESS_CONNECTOR_KEY, trueProcessHarnessEnabled } from '../connectors/base-connectors';

@Injectable()
export class PermissionsService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService, private readonly registry: ConnectorRegistry) {}

  async list(userId: string, connectionId: string) {
    await this.assertOwnedConnection(userId, connectionId);
    const rows = await this.db.select({
      id: connectionPermissions.id,
      capability: connectorCapabilities.key,
      name: connectorCapabilities.name,
      riskLevel: connectorCapabilities.riskLevel,
      granted: connectionPermissions.granted,
      grantedAt: connectionPermissions.grantedAt,
      expiresAt: connectionPermissions.expiresAt,
      revokedAt: connectionPermissions.revokedAt,
    }).from(connectorCapabilities)
      .innerJoin(connections, eq(connectorCapabilities.connectorId, connections.connectorId))
      .leftJoin(connectionPermissions, and(
        eq(connectionPermissions.connectionId, connections.id),
        eq(connectionPermissions.connectorCapabilityId, connectorCapabilities.id),
      ))
      .where(eq(connections.id, connectionId));
    const now = Date.now();
    return rows.map((row) => ({
      ...row,
      granted: row.granted === 1 && !row.revokedAt && (!row.expiresAt || row.expiresAt.getTime() > now),
    }));
  }

  async update(userId: string, connectionId: string, updates: PermissionUpdateDto[]) {
    const connection = await this.assertOwnedConnection(userId, connectionId);
    if (connection.status === 'revoked') throw new ForbiddenException('Connection has been revoked');
    const now = new Date();

    for (const update of updates) {
      const capabilities = await this.db.select({ id: connectorCapabilities.id, key: connectorCapabilities.key })
        .from(connectorCapabilities)
        .where(and(eq(connectorCapabilities.connectorId, connection.connectorId), eq(connectorCapabilities.key, update.capability)))
        .limit(1);
      const capability = capabilities[0];
      if (!capability) throw new NotFoundException(`Capability not found: ${update.capability}`);
      const expiresAt = update.expiresAt ? new Date(update.expiresAt) : null;
      const before = await this.db.select({ granted: connectionPermissions.granted, revokedAt: connectionPermissions.revokedAt, expiresAt: connectionPermissions.expiresAt })
        .from(connectionPermissions)
        .where(and(eq(connectionPermissions.connectionId, connectionId), eq(connectionPermissions.connectorCapabilityId, capability.id)))
        .limit(1);
      await this.db.transaction(async (tx) => {
        await tx.insert(connectionPermissions).values({
          id: newId(),
          connectionId,
          connectorCapabilityId: capability.id,
          granted: update.granted ? 1 : 0,
          grantedAt: update.granted ? now : null,
          expiresAt,
          revokedAt: update.granted ? null : now,
          createdAt: now,
          updatedAt: now,
        }).onDuplicateKeyUpdate({ set: {
          granted: update.granted ? 1 : 0,
          grantedAt: update.granted ? now : null,
          expiresAt,
          revokedAt: update.granted ? null : now,
          updatedAt: now,
        } });
        // 权限变更与 Audit 同事务。
        await this.audit.append({
          actorType: 'user', actorUserId: userId, action: 'PERMISSION_CHANGE', resourceType: 'connection_permission',
          resourceId: connectionId, userId, correlationId: connectionId, causationId: capability.id,
          before: before[0] ? { capability: capability.key, granted: before[0].granted === 1, revokedAt: before[0].revokedAt, expiresAt: before[0].expiresAt } : null,
          after: { capability: capability.key, granted: update.granted, expiresAt },
          changeSummary: `Permission ${update.capability} ${update.granted ? 'granted' : 'revoked'} on connection ${connectionId}`,
          source: 'api', result: 'success',
        }, tx);
      });
    }
    return this.list(userId, connectionId);
  }

  async assertGranted(userId: string, connectionId: string, capabilityKey: string) {
    const connection = await this.assertOwnedConnection(userId, connectionId);
    if (
      (connection.expiresAt && connection.expiresAt <= new Date())
      || (connection.status !== 'connected' && connection.status !== 'degraded' && connection.status !== 'provider_error')
    ) {
      throw new ForbiddenException('Connection is not available');
    }
    const rows = await this.db.select({
      granted: connectionPermissions.granted,
      expiresAt: connectionPermissions.expiresAt,
      revokedAt: connectionPermissions.revokedAt,
      operation: connectorCapabilities.operation,
      providerAvailability: connectorCapabilities.providerAvailability,
    }).from(connectionPermissions)
      .innerJoin(connectorCapabilities, eq(connectionPermissions.connectorCapabilityId, connectorCapabilities.id))
      .where(and(eq(connectionPermissions.connectionId, connectionId), eq(connectorCapabilities.key, capabilityKey)))
      .limit(1);
    const permission = rows[0];
    if (!permission || permission.granted !== 1 || permission.revokedAt || (permission.expiresAt && permission.expiresAt <= new Date())) {
      throw new ForbiddenException(`Capability permission denied: ${capabilityKey}`);
    }
    if (!this.providerCapabilityEnabled(connection.connectorKey, capabilityKey)) {
      throw new ForbiddenException(`Provider capability is disabled: ${capabilityKey}`);
    }
    return { connection, operation: permission.operation };
  }

  private async assertOwnedConnection(userId: string, connectionId: string) {
    const rows = await this.db.select({ id: connections.id, connectorId: connections.connectorId, connectorKey: connectors.key, status: connections.status, expiresAt: connections.expiresAt, productionStatus: connectors.productionStatus })
      .from(connections)
      .innerJoin(connectors, eq(connections.connectorId, connectors.id))
      .where(and(eq(connections.id, connectionId), eq(connections.userId, userId)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Connection not found');
    return rows[0];
  }

  private providerCapabilityEnabled(connectorKey: string, capabilityKey: string) {
    const adapter = this.registry.get(connectorKey);
    const metadata = adapter.metadata();
    const capability = adapter.capabilities().find((item) => item.key === capabilityKey);
    // Legacy dynamically registered connectors only exist in isolated tests.
    // Production adapters must declare a complete gate contract.
    if (!metadata.productionStatus || !capability) return process.env.NODE_ENV === 'test';
    if (metadata.key === TRUE_PROCESS_HARNESS_CONNECTOR_KEY && trueProcessHarnessEnabled(process.env)) return true;
    return metadata.productionStatus !== 'DISABLED' && capability.providerAvailability !== 'disabled';
  }
}
