import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorRegistry, type ConnectorRequest } from '@lazy-armor/connector-sdk';
import { connections, connectors, credentialRefs, credentialVersions, connectionPermissions } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { CREDENTIAL_PROVIDER, type CredentialProvider } from '../credentials/credential-provider';
import { PermissionsService } from '../permissions/permissions.service';
import type { CreateConnectionDto, InvokeConnectorDto, RotateConnectionCredentialsDto } from './dto';

@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    @Inject(CREDENTIAL_PROVIDER) private readonly credentials: CredentialProvider,
    private readonly registry: ConnectorRegistry,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, input: CreateConnectionDto) {
    let adapter;
    try { adapter = this.registry.get(input.connectorId); } catch { throw new NotFoundException('Connector not found'); }
    const catalogRows = await this.db.select({ id: connectors.id }).from(connectors).where(eq(connectors.key, input.connectorId)).limit(1);
    const catalog = catalogRows[0];
    if (!catalog) throw new NotFoundException('Connector catalog is not migrated');

    const now = new Date();
    if (input.expiresAt && new Date(input.expiresAt) <= now) throw new BadRequestException('Connection expiry must be in the future');
    const connectionId = newId();
    let credentialRef: string | undefined;
    let credentialRefId: string | undefined;
    let credentialVersion: number | undefined;
    let credentialProvider: string | undefined;
    if (input.credentials && Object.keys(input.credentials).length) {
      credentialRef = await this.credentials.set(input.credentials);
      credentialRefId = newId();
      credentialVersion = await this.credentials.currentVersion(credentialRef);
      credentialProvider = (await this.credentials.health()).provider;
    }

    try {
      await this.db.transaction(async (tx) => {
        if (credentialRef && credentialRefId && credentialVersion && credentialProvider) {
          await tx.insert(credentialRefs).values({ id: credentialRefId, ref: credentialRef, provider: credentialProvider, status: 'active', currentVersion: credentialVersion, rotatedAt: null, createdAt: now, updatedAt: now });
          await tx.insert(credentialVersions).values({ id: newId(), credentialRefId, version: credentialVersion, providerRef: credentialRef, status: 'active', expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, revokedAt: null, createdAt: now });
        }
        await tx.insert(connections).values({
          id: connectionId,
          userId,
          connectorId: catalog.id,
          externalAccountName: input.externalAccountName,
          status: 'connected',
          credentialRefId: credentialRefId ?? null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          lastCheckedAt: null,
          createdAt: now,
          updatedAt: now,
        });
      });
    } catch (error) {
      if (credentialRef) await this.credentials.revoke(credentialRef);
      throw error;
    }

    await adapter.validateConnection();
    return this.get(userId, connectionId);
  }

  async list(userId: string) {
    const rows = await this.baseSelect().where(eq(connections.userId, userId));
    return rows.map(this.toResponse);
  }

  async get(userId: string, id: string) {
    const rows = await this.baseSelect().where(and(eq(connections.id, id), eq(connections.userId, userId))).limit(1);
    if (!rows[0]) throw new NotFoundException('Connection not found');
    return this.toResponse(rows[0]);
  }

  async validate(userId: string, id: string) {
    const current = await this.getWithSecretRef(userId, id);
    if (current.status === 'revoked') throw new ForbiddenException('Connection has been revoked');
    if (current.credentialRef && current.credentialCurrentVersion) await this.credentials.get(current.credentialRef, current.credentialCurrentVersion);
    const health = await this.registry.get(current.connectorKey).validateConnection();
    const status = health.status === 'healthy' ? 'connected' : health.status === 'degraded' ? 'degraded' : 'error';
    await this.db.update(connections).set({ status, lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(connections.id, id));
    return { connection: await this.get(userId, id), health };
  }

  async revoke(userId: string, id: string) {
    const current = await this.getWithSecretRef(userId, id);
    if (current.status === 'revoked') return;
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.update(connections).set({ status: 'revoked', updatedAt: now }).where(and(eq(connections.id, id), eq(connections.userId, userId)));
      await tx.update(connectionPermissions).set({ granted: 0, revokedAt: now, updatedAt: now }).where(eq(connectionPermissions.connectionId, id));
      if (current.credentialRefId) {
        await tx.update(credentialRefs).set({ status: 'revoked', updatedAt: now }).where(eq(credentialRefs.id, current.credentialRefId));
        await tx.update(credentialVersions).set({ status: 'revoked', revokedAt: now }).where(eq(credentialVersions.credentialRefId, current.credentialRefId));
      }
      // 连接撤销与 Audit 同事务。
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'CONNECTION_REVOKED', resourceType: 'connection', resourceId: id, userId, correlationId: id, changeSummary: `Connection ${id} revoked`, source: 'api', result: 'success' }, tx);
    });
    await this.registry.get(current.connectorKey).revoke?.();
    if (current.credentialRef) await this.credentials.revoke(current.credentialRef);
  }

  async rotateCredentials(userId: string, id: string, input: RotateConnectionCredentialsDto) {
    if (!input.credentials || Object.keys(input.credentials).length === 0) throw new BadRequestException('credentials cannot be empty');
    const current = await this.getWithSecretRef(userId, id);
    if (current.status === 'revoked') throw new ForbiddenException('Connection has been revoked');
    if (!current.credentialRef || !current.credentialRefId || !current.credentialCurrentVersion) throw new BadRequestException('Connection has no credential reference to rotate');
    if (input.expiresAt && new Date(input.expiresAt) <= new Date()) throw new BadRequestException('Credential expiry must be in the future');
    const rotated = await this.credentials.rotate(current.credentialRef, input.credentials);
    const now = new Date();
    try {
      await this.db.transaction(async (tx) => {
        const locked = (await tx.select({ currentVersion: credentialRefs.currentVersion, status: credentialRefs.status }).from(credentialRefs).where(eq(credentialRefs.id, current.credentialRefId!)).limit(1).for('update'))[0];
        if (!locked || locked.status !== 'active' || locked.currentVersion !== current.credentialCurrentVersion) throw new ConflictException('Credential was rotated concurrently');
        await tx.update(credentialVersions).set({ status: 'superseded' }).where(and(eq(credentialVersions.credentialRefId, current.credentialRefId!), eq(credentialVersions.status, 'active')));
        await tx.insert(credentialVersions).values({ id: newId(), credentialRefId: current.credentialRefId!, version: rotated.version, providerRef: rotated.ref, status: 'active', expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, revokedAt: null, createdAt: now });
        await tx.update(credentialRefs).set({ currentVersion: rotated.version, rotatedAt: now, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, updatedAt: now }).where(eq(credentialRefs.id, current.credentialRefId!));
        await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'CREDENTIAL_ROTATED', resourceType: 'connection', resourceId: id, userId, correlationId: id, before: { version: current.credentialCurrentVersion }, after: { version: rotated.version }, changeSummary: 'Connection credential rotated to a new immutable version', source: 'api', result: 'success' }, tx);
      });
    } catch (error) {
      await this.credentials.revokeVersion(current.credentialRef, rotated.version).catch(() => undefined);
      throw error;
    }
    return { connection: await this.get(userId, id), credentialVersion: rotated.version };
  }

  async invoke(userId: string, id: string, input: InvokeConnectorDto) {
    const grant = await this.permissions.assertGranted(userId, id, input.capability);
    const current = await this.getWithSecretRef(userId, id);
    const adapter = this.registry.get(current.connectorKey);
    const request: ConnectorRequest = { capability: input.capability, input: input.input, requestId: input.requestId, idempotencyKey: input.idempotencyKey };
    if (grant.operation === 'read' && adapter.read) return adapter.read(request);
    if (grant.operation === 'execute' && adapter.execute) return adapter.execute(request);
    if (grant.operation === 'subscribe' && adapter.subscribe) return adapter.subscribe(request);
    throw new BadRequestException('Connector does not implement the requested operation');
  }

  private baseSelect() {
    return this.db.select({
      id: connections.id,
      connectorId: connectors.key,
      connectorName: connectors.name,
      externalAccountName: connections.externalAccountName,
      status: connections.status,
      expiresAt: connections.expiresAt,
      lastCheckedAt: connections.lastCheckedAt,
      createdAt: connections.createdAt,
      updatedAt: connections.updatedAt,
    }).from(connections).innerJoin(connectors, eq(connections.connectorId, connectors.id));
  }

  private async getWithSecretRef(userId: string, id: string) {
    const rows = await this.db.select({
      id: connections.id,
      status: connections.status,
      connectorKey: connectors.key,
      credentialRefId: connections.credentialRefId,
      credentialRef: credentialRefs.ref,
      credentialCurrentVersion: credentialRefs.currentVersion,
    }).from(connections)
      .innerJoin(connectors, eq(connections.connectorId, connectors.id))
      .leftJoin(credentialRefs, eq(connections.credentialRefId, credentialRefs.id))
      .where(and(eq(connections.id, id), eq(connections.userId, userId)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Connection not found');
    return rows[0];
  }

  private readonly toResponse = <T extends { status: string; expiresAt: Date | null }>(row: T) => ({
    ...row,
    status: row.status !== 'revoked' && row.expiresAt && row.expiresAt <= new Date() ? 'expired' : row.status,
  });
}
