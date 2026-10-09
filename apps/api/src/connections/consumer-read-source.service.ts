import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { auditLogs, connectionCapabilityGrants, connectionPermissions, connections, connectorCapabilities, credentialRefs, providerCapabilityHealth } from '@lazy-armor/database';
import { catalogHash } from '@lazy-armor/plan-schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CapabilityUsabilityService } from '../provider-capabilities/capability-usability.service';

export interface ConsumerReadSource { userId: string; connectionId: string; capabilityKey: string; authorityHash: string }

/** Fences the existing consumer read inspection; never issues Invocation or Truth authority. */
@Injectable()
export class ConsumerReadSourceService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly usability: CapabilityUsabilityService) {}
  async capture(userId: string, connectionId: string, capabilityKey: string): Promise<ConsumerReadSource> {
    const view = await this.usability.resolveConnection(userId, connectionId);
    const capability = view.capabilities.find(item => item.key === capabilityKey);
    if (!capability || capability.operation !== 'read' || !capability.usable) throw new ForbiddenException('读取能力暂不可用，请核对授权并检查连接');
    const connection = (await this.db.select().from(connections).where(and(eq(connections.id, connectionId), eq(connections.userId, userId))).limit(1))[0];
    if (!connection) throw new NotFoundException('Connection not found');
    const grant = (await this.db.select().from(connectionCapabilityGrants).where(and(eq(connectionCapabilityGrants.connectionId, connectionId), eq(connectionCapabilityGrants.capabilityKey, capabilityKey))))[0];
    const health = (await this.db.select().from(providerCapabilityHealth).where(and(eq(providerCapabilityHealth.connectionId, connectionId), eq(providerCapabilityHealth.capabilityKey, capabilityKey))))[0];
    const permission = (await this.db.select({ permission: connectionPermissions }).from(connectionPermissions).innerJoin(connectorCapabilities, eq(connectorCapabilities.id, connectionPermissions.connectorCapabilityId))
      .where(and(eq(connectionPermissions.connectionId, connectionId), eq(connectorCapabilities.key, capabilityKey))))[0]?.permission;
    if (!permission || permission.granted !== 1 || permission.revokedAt || (permission.expiresAt && permission.expiresAt <= new Date())) throw new ForbiddenException('读取权限已变化，请重新核对');
    const credential = connection.credentialRefId && (await this.db.select({ id: credentialRefs.id, currentVersion: credentialRefs.currentVersion, status: credentialRefs.status, expiresAt: credentialRefs.expiresAt })
      .from(credentialRefs).where(eq(credentialRefs.id, connection.credentialRefId)))[0];
    if (connection.credentialRefId && (!credential || credential.status !== 'active' || (credential.expiresAt && credential.expiresAt <= new Date()))) throw new ForbiddenException('连接配置已失效，请重新连接');
    // Append-only authority audit count catches revoke/regrant even when final fields are restored.
    const [history] = await this.db.select({ count: sql<number>`COUNT(*)` }).from(auditLogs).where(and(eq(auditLogs.userId, userId), eq(auditLogs.resourceId, connectionId),
      inArray(auditLogs.action, ['PERMISSION_CHANGE', 'CONNECTION_REVOKED', 'CONNECTION_REAUTHORIZED', 'CREDENTIAL_ROTATED'])));
    const stamp = JSON.parse(JSON.stringify({ connection: { id: connection.id, status: connection.status, expiresAt: connection.expiresAt, updatedAt: connection.updatedAt },
      grant, permission, health, credential: credential || null, authorityChanges: Number(history?.count ?? 0), manifestHash: view.manifestHash }));
    return { userId, connectionId, capabilityKey, authorityHash: catalogHash(stamp) };
  }
  async assertCurrent(source: ConsumerReadSource) {
    const current = await this.capture(source.userId, source.connectionId, source.capabilityKey);
    if (current.authorityHash !== source.authorityHash) throw new ForbiddenException('读取期间来源或授权已变化，请重新读取');
  }
}
