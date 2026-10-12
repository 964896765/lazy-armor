import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { auditLogs, connectionCapabilityGrants, connectionPermissions, connections, connectorCapabilities, credentialRefs, providerCapabilityHealth } from '@lazy-armor/database';
import { catalogHash } from '@lazy-armor/plan-schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CapabilityUsabilityService } from '../provider-capabilities/capability-usability.service';
import { capabilityAvailability } from '../provider-capabilities/capability-availability';

export interface ConsumerReadSource { userId: string; connectionId: string; capabilityKey: string; authorityHash: string }
export type ConsumerReadTransaction = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];

/** Fences the existing consumer read inspection; never issues Invocation or Truth authority. */
@Injectable()
export class ConsumerReadSourceService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly usability: CapabilityUsabilityService) {}
  async capture(userId: string, connectionId: string, capabilityKey: string, transaction?: ConsumerReadTransaction): Promise<ConsumerReadSource> {
    const database = transaction ?? this.db;
    const view = await this.usability.resolveConnection(userId, connectionId);
    const capability = view.capabilities.find(item => item.key === capabilityKey);
    if (!capability || capability.operation !== 'read' || !capability.usable) throw new ForbiddenException('读取能力暂不可用，请核对授权并检查连接');
    const connection = (await database.select().from(connections).where(and(eq(connections.id, connectionId), eq(connections.userId, userId))).limit(1).for('update'))[0];
    if (!connection) throw new NotFoundException('Connection not found');
    const grant = (await database.select().from(connectionCapabilityGrants).where(and(eq(connectionCapabilityGrants.connectionId, connectionId), eq(connectionCapabilityGrants.capabilityKey, capabilityKey))).for('update'))[0];
    const health = (await database.select().from(providerCapabilityHealth).where(and(eq(providerCapabilityHealth.connectionId, connectionId), eq(providerCapabilityHealth.capabilityKey, capabilityKey))).for('update'))[0];
    const permission = (await database.select({ permission: connectionPermissions }).from(connectionPermissions).innerJoin(connectorCapabilities, eq(connectorCapabilities.id, connectionPermissions.connectorCapabilityId))
      .where(and(eq(connectionPermissions.connectionId, connectionId), eq(connectorCapabilities.key, capabilityKey))).for('update'))[0]?.permission;
    if (!permission || permission.granted !== 1 || permission.revokedAt || (permission.expiresAt && permission.expiresAt <= new Date())) throw new ForbiddenException('读取权限已变化，请重新核对');
    const credential = connection.credentialRefId && (await database.select({ id: credentialRefs.id, currentVersion: credentialRefs.currentVersion, status: credentialRefs.status, expiresAt: credentialRefs.expiresAt })
      .from(credentialRefs).where(eq(credentialRefs.id, connection.credentialRefId)).for('update'))[0];
    if (connection.credentialRefId && (!credential || credential.status !== 'active' || (credential.expiresAt && credential.expiresAt <= new Date()))) throw new ForbiddenException('连接配置已失效，请重新连接');
    const lockedState = capabilityAvailability({ providerKey: view.providerKey, connection, scopes: [], grant, health,
      credentialRequired: Boolean(connection.credentialRefId), credential: credential || null, now: new Date() });
    if (!lockedState.connectionReady || !lockedState.grantSatisfied || !lockedState.healthUsable)
      throw new ForbiddenException('读取来源或授权已失效，请重新核对');
    // Append-only authority audit count catches revoke/regrant even when final fields are restored.
    const [history] = await database.select({ count: sql<number>`COUNT(*)` }).from(auditLogs).where(and(eq(auditLogs.userId, userId), eq(auditLogs.resourceId, connectionId),
      inArray(auditLogs.action, ['PERMISSION_CHANGE', 'CONNECTION_REVOKED', 'CONNECTION_REAUTHORIZED', 'CREDENTIAL_ROTATED']))).for('update');
    const stamp = JSON.parse(JSON.stringify({ connection: { id: connection.id, status: connection.status, expiresAt: connection.expiresAt, updatedAt: connection.updatedAt },
      grant, permission, health, credential: credential || null, authorityChanges: Number(history?.count ?? 0), manifestHash: view.manifestHash }));
    return { userId, connectionId, capabilityKey, authorityHash: catalogHash(stamp) };
  }
  async assertCurrent(source: ConsumerReadSource, transaction?: ConsumerReadTransaction) {
    const current = await this.capture(source.userId, source.connectionId, source.capabilityKey, transaction);
    if (current.authorityHash !== source.authorityHash) throw new ForbiddenException('读取期间来源或授权已变化，请重新读取');
  }
}
