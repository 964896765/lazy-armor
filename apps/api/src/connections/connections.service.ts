import { randomBytes } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorError, ConnectorRegistry, type ConnectorRequest } from '@lazy-armor/connector-sdk';
import { connections, connectors, credentialRefs, credentialVersions, connectionPermissions, connectorCapabilities, oauthAuthorizationStates } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { CREDENTIAL_PROVIDER, CredentialProviderError, type CredentialProvider } from '../credentials/credential-provider';
import { PermissionsService } from '../permissions/permissions.service';
import type {
  CompleteOAuthConnectionDto,
  CreateConnectionDto,
  InvokeConnectorDto,
  RotateConnectionCredentialsDto,
  StartOAuthConnectionDto,
} from './dto';

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
    const adapter = this.getAdapter(input.connectorId);
    const catalog = await this.requireCatalog(input.connectorId);
    if (adapter.metadata().authentication.type === 'oauth2' && (!input.credentials || Object.keys(input.credentials).length === 0)) {
      throw new BadRequestException('OAuth provider must be connected through the authorization flow');
    }
    const connectionId = await this.createConnectionRecord(userId, {
      connectorKey: input.connectorId,
      externalAccountName: input.externalAccountName,
      credentials: input.credentials,
      expiresAt: input.expiresAt ?? null,
      grantedCapabilities: adapter.capabilities().map((capability) => capability.key),
      connectorId: catalog.id,
      status: 'connected',
      statusReason: null,
    });
    await this.validate(userId, connectionId);
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
    const request = await this.connectorRequestFor(userId, current);
    const health = await (this.registry.get(current.connectorKey).validateConnection?.(request) ?? Promise.resolve({ status: 'healthy' as const, checkedAt: new Date().toISOString(), reason: undefined }));
    const status = mapHealthToConnectionStatus(health.status);
    await this.db.update(connections).set({
      status,
      statusReason: health.reason ?? null,
      lastErrorCode: status === 'connected' ? null : health.reason ?? null,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(connections.id, id));
    return { connection: await this.get(userId, id), health };
  }

  async startOAuth(userId: string, providerKey: string, input: StartOAuthConnectionDto) {
    const connector = this.getAdapter(providerKey);
    const metadata = connector.metadata();
    if (metadata.authentication.type !== 'oauth2' || !connector.startAuthorization) {
      throw new BadRequestException('Provider does not support OAuth authorization');
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    const state = randomBytes(24).toString('hex');
    const codeVerifier = metadata.authentication.oauth2?.supportsPKCE ? randomBytes(32).toString('hex') : null;
    await this.db.insert(oauthAuthorizationStates).values({
      id: newId(),
      userId,
      providerKey,
      connectionId: null,
      state,
      redirectUri: input.redirectUri,
      codeVerifier,
      expiresAt,
      consumedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const started = await connector.startAuthorization({
      userId,
      state,
      redirectUri: input.redirectUri,
      codeVerifier: codeVerifier ?? undefined,
    });
    return {
      providerKey,
      authorizationUrl: started.authorizationUrl,
      expiresAt: started.expiresAt,
    };
  }

  async completeOAuth(userId: string, providerKey: string, input: CompleteOAuthConnectionDto) {
    const connector = this.getAdapter(providerKey);
    if (!connector.completeAuthorization) throw new BadRequestException('Provider does not support OAuth callback');
    const rows = await this.db.select().from(oauthAuthorizationStates).where(and(
      eq(oauthAuthorizationStates.userId, userId),
      eq(oauthAuthorizationStates.providerKey, providerKey),
      eq(oauthAuthorizationStates.state, input.state),
      isNull(oauthAuthorizationStates.consumedAt),
    )).limit(1);
    const pending = rows[0];
    if (!pending) throw new ForbiddenException('OAuth state is invalid or already consumed');
    if (pending.expiresAt <= new Date()) throw new ForbiddenException('OAuth state has expired');
    if (pending.redirectUri !== input.redirectUri) throw new ForbiddenException('OAuth callback redirect is not allowed');
    const completed = await connector.completeAuthorization({
      userId,
      state: input.state,
      code: input.code,
      redirectUri: input.redirectUri,
      codeVerifier: pending.codeVerifier ?? undefined,
    });
    await this.db.update(oauthAuthorizationStates).set({ consumedAt: new Date(), updatedAt: new Date() }).where(eq(oauthAuthorizationStates.id, pending.id));
    const connectionId = pending.connectionId
      ? await this.reconnectFromAuthorization(userId, pending.connectionId, providerKey, completed)
      : await this.createConnectionRecord(userId, {
        connectorKey: providerKey,
        connectorId: (await this.requireCatalog(providerKey)).id,
        externalAccountName: completed.externalAccountName,
        credentials: completed.credentials,
        expiresAt: completed.expiresAt ?? null,
        grantedCapabilities: completed.grantedCapabilities ?? [],
        status: 'connected',
        statusReason: null,
      });
    return this.get(userId, connectionId);
  }

  async reconnect(userId: string, id: string, input: StartOAuthConnectionDto) {
    const current = await this.getWithSecretRef(userId, id);
    const connector = this.getAdapter(current.connectorKey);
    const metadata = connector.metadata();
    if (metadata.authentication.type !== 'oauth2' || !connector.startAuthorization) {
      throw new BadRequestException('Provider does not support OAuth reconnect');
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    const state = randomBytes(24).toString('hex');
    const codeVerifier = metadata.authentication.oauth2?.supportsPKCE ? randomBytes(32).toString('hex') : null;
    await this.db.insert(oauthAuthorizationStates).values({
      id: newId(),
      userId,
      providerKey: current.connectorKey,
      connectionId: current.id,
      state,
      redirectUri: input.redirectUri,
      codeVerifier,
      expiresAt,
      consumedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const started = await connector.startAuthorization({
      userId,
      state,
      redirectUri: input.redirectUri,
      codeVerifier: codeVerifier ?? undefined,
    });
    await this.db.update(connections).set({ status: 'pending_authorization', statusReason: 'reauthorization_started', updatedAt: new Date() }).where(eq(connections.id, id));
    return {
      providerKey: current.connectorKey,
      authorizationUrl: started.authorizationUrl,
      expiresAt: started.expiresAt,
    };
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
    try {
      await this.registry.get(current.connectorKey).revoke?.();
    } catch (error) {
      await this.audit.append({
        actorType: 'system',
        action: 'CONNECTION_PROVIDER_REVOKE_FAILED',
        resourceType: 'connection',
        resourceId: id,
        userId,
        correlationId: id,
        changeSummary: error instanceof Error ? error.message : 'Provider revoke failed',
        source: 'api',
        result: 'failure',
      });
    }
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
    const request = await this.connectorRequestFor(userId, current, {
      capability: input.capability,
      input: input.input,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
    });
    try {
      if (grant.operation === 'read' && adapter.read) return await adapter.read(request);
      if (grant.operation === 'execute' && adapter.execute) return await adapter.execute(request);
      if (grant.operation === 'subscribe' && adapter.subscribe) return await adapter.subscribe(request);
      throw new BadRequestException('Connector does not implement the requested operation');
    } catch (error) {
      await this.handleConnectorFailure(current.id, error);
      throw mapConnectorError(error);
    }
  }

  private baseSelect() {
    return this.db.select({
      id: connections.id,
      connectorId: connectors.key,
      connectorName: connectors.name,
      connectorDescription: connectors.description,
      providerType: connectors.providerType,
      productionStatus: connectors.productionStatus,
      externalAccountName: connections.externalAccountName,
      status: connections.status,
      statusReason: connections.statusReason,
      lastErrorCode: connections.lastErrorCode,
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
      statusReason: connections.statusReason,
      lastErrorCode: connections.lastErrorCode,
      connectorKey: connectors.key,
      connectorCatalogId: connectors.id,
      authenticationType: connectors.authenticationType,
      supportsRefresh: connectors.supportsRefresh,
      credentialRefId: connections.credentialRefId,
      credentialRef: credentialRefs.ref,
      credentialCurrentVersion: credentialRefs.currentVersion,
      credentialExpiresAt: credentialRefs.expiresAt,
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
    status: row.status === 'connected' && row.expiresAt && row.expiresAt <= new Date() ? 'expired' : row.status,
  });

  private getAdapter(key: string) {
    try {
      return this.registry.get(key);
    } catch {
      throw new NotFoundException('Connector not found');
    }
  }

  private async requireCatalog(key: string) {
    const catalogRows = await this.db.select({ id: connectors.id }).from(connectors).where(eq(connectors.key, key)).limit(1);
    const catalog = catalogRows[0];
    if (!catalog) throw new NotFoundException('Connector catalog is not migrated');
    return catalog;
  }

  private async createConnectionRecord(userId: string, input: {
    connectorKey: string;
    connectorId: string;
    externalAccountName: string;
    credentials?: Record<string, string>;
    expiresAt: string | null;
    grantedCapabilities: string[];
    status: string;
    statusReason: string | null;
  }) {
    const now = new Date();
    const connectionId = newId();
    let credentialRef: string | undefined;
    let credentialRefId: string | undefined;
    let credentialVersion: number | undefined;
    let credentialProvider: string | undefined;
    if (input.credentials && Object.keys(input.credentials).length > 0) {
      credentialRef = await this.credentials.set(input.credentials);
      credentialRefId = newId();
      credentialVersion = await this.credentials.currentVersion(credentialRef);
      credentialProvider = (await this.credentials.health()).provider;
    }
    try {
      await this.db.transaction(async (tx) => {
        if (credentialRef && credentialRefId && credentialVersion && credentialProvider) {
          await tx.insert(credentialRefs).values({
            id: credentialRefId,
            ref: credentialRef,
            provider: credentialProvider,
            status: 'active',
            currentVersion: credentialVersion,
            rotatedAt: null,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            createdAt: now,
            updatedAt: now,
          });
          await tx.insert(credentialVersions).values({
            id: newId(),
            credentialRefId,
            version: credentialVersion,
            providerRef: credentialRef,
            status: 'active',
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            revokedAt: null,
            createdAt: now,
          });
        }
        await tx.insert(connections).values({
          id: connectionId,
          userId,
          connectorId: input.connectorId,
          externalAccountName: input.externalAccountName,
          status: input.status,
          statusReason: input.statusReason,
          lastErrorCode: null,
          credentialRefId: credentialRefId ?? null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          lastCheckedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        await this.seedGrantedCapabilities(tx, connectionId, input.connectorId, input.grantedCapabilities, now);
        await this.audit.append({
          actorType: 'user',
          actorUserId: userId,
          action: 'CONNECTION_CREATED',
          resourceType: 'connection',
          resourceId: connectionId,
          userId,
          correlationId: connectionId,
          changeSummary: `Connection ${input.connectorKey} created`,
          source: 'api',
          result: 'success',
        }, tx);
      });
    } catch (error) {
      if (credentialRef) await this.credentials.revoke(credentialRef).catch(() => undefined);
      throw error;
    }
    return connectionId;
  }

  private async reconnectFromAuthorization(userId: string, connectionId: string, providerKey: string, completed: {
    externalAccountName: string;
    credentials: Record<string, string>;
    expiresAt?: string | null;
    grantedCapabilities?: string[];
  }) {
    const current = await this.getWithSecretRef(userId, connectionId);
    if (current.connectorKey !== providerKey) throw new ForbiddenException('OAuth provider does not match the connection');
    const now = new Date();
    let version: number | null = null;
    if (current.credentialRef) {
      const rotated = await this.credentials.rotate(current.credentialRef, completed.credentials);
      version = rotated.version;
      const credentialRefId = current.credentialRefId;
      await this.db.transaction(async (tx) => {
        if (credentialRefId) {
          await tx.update(credentialVersions).set({ status: 'superseded' }).where(and(eq(credentialVersions.credentialRefId, credentialRefId), eq(credentialVersions.status, 'active')));
          await tx.insert(credentialVersions).values({
            id: newId(),
            credentialRefId,
            version: rotated.version,
            providerRef: rotated.ref,
            status: 'active',
            expiresAt: completed.expiresAt ? new Date(completed.expiresAt) : null,
            revokedAt: null,
            createdAt: now,
          });
          await tx.update(credentialRefs).set({
            currentVersion: rotated.version,
            status: 'active',
            rotatedAt: now,
            expiresAt: completed.expiresAt ? new Date(completed.expiresAt) : null,
            updatedAt: now,
          }).where(eq(credentialRefs.id, credentialRefId));
        }
        await tx.update(connections).set({
          externalAccountName: completed.externalAccountName,
          status: 'connected',
          statusReason: null,
          lastErrorCode: null,
          expiresAt: completed.expiresAt ? new Date(completed.expiresAt) : null,
          updatedAt: now,
        }).where(eq(connections.id, connectionId));
        await this.seedGrantedCapabilities(tx, connectionId, current.connectorCatalogId, completed.grantedCapabilities ?? [], now);
        await this.audit.append({
          actorType: 'user',
          actorUserId: userId,
          action: 'CONNECTION_REAUTHORIZED',
          resourceType: 'connection',
          resourceId: connectionId,
          userId,
          correlationId: connectionId,
          after: { version },
          changeSummary: `Connection ${connectionId} reauthorized`,
          source: 'api',
          result: 'success',
        }, tx);
      });
      return connectionId;
    }
    await this.db.update(connections).set({
      externalAccountName: completed.externalAccountName,
      status: 'connected',
      statusReason: null,
      lastErrorCode: null,
      updatedAt: now,
    }).where(eq(connections.id, connectionId));
    return connectionId;
  }

  private async seedGrantedCapabilities(tx: { select: InjectedDatabase['select']; insert: InjectedDatabase['insert'] }, connectionId: string, connectorId: string, capabilityKeys: string[], now: Date) {
    if (capabilityKeys.length === 0) return;
    const rows = await tx.select({ id: connectorCapabilities.id, key: connectorCapabilities.key })
      .from(connectorCapabilities)
      .where(eq(connectorCapabilities.connectorId, connectorId));
    for (const capability of rows.filter((row) => capabilityKeys.includes(row.key))) {
      await tx.insert(connectionPermissions).values({
        id: newId(),
        connectionId,
        connectorCapabilityId: capability.id,
        granted: 1,
        grantedAt: now,
        expiresAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      }).onDuplicateKeyUpdate({
        set: {
          granted: 1,
          grantedAt: now,
          revokedAt: null,
          updatedAt: now,
        },
      });
    }
  }

  private async connectorRequestFor(
    userId: string,
    current: Awaited<ReturnType<ConnectionsService['getWithSecretRef']>>,
    partial?: Partial<ConnectorRequest>,
  ): Promise<ConnectorRequest> {
    const adapter = this.registry.get(current.connectorKey);
    let credentialData: Record<string, string> | undefined;
    let credentialVersion = current.credentialCurrentVersion ?? undefined;
    let credentialExpiresAt = current.credentialExpiresAt ? current.credentialExpiresAt.toISOString() : null;
    if (current.credentialRef && current.credentialCurrentVersion) {
      try {
        credentialData = await this.credentials.get(current.credentialRef, current.credentialCurrentVersion);
      } catch (error) {
        if (error instanceof CredentialProviderError && error.retryable) {
          await this.db.update(connections).set({ status: 'provider_error', statusReason: 'credential_provider_unavailable', lastErrorCode: error.code, updatedAt: new Date() }).where(eq(connections.id, current.id));
          throw new BadRequestException('Credential provider is temporarily unavailable');
        }
        await this.db.update(connections).set({ status: 'reauthorization_required', statusReason: 'credential_invalid', lastErrorCode: 'CREDENTIAL_INVALID', updatedAt: new Date() }).where(eq(connections.id, current.id));
        throw new ForbiddenException('Connection credentials are no longer valid');
      }
      const expiresAt = credentialData.expiresAt ? new Date(credentialData.expiresAt) : current.credentialExpiresAt;
      if (expiresAt && expiresAt.getTime() <= Date.now() + 60_000) {
        if (!adapter.refreshCredentials || !credentialData.refreshToken) {
          await this.db.update(connections).set({ status: 'reauthorization_required', statusReason: 'refresh_required', lastErrorCode: 'AUTH_REQUIRED', updatedAt: new Date() }).where(eq(connections.id, current.id));
          throw new ForbiddenException('Connection requires reauthorization');
        }
        try {
          const refreshed = await adapter.refreshCredentials({ credential: credentialData });
          const rotated = await this.credentials.rotate(current.credentialRef, refreshed.credentials);
          credentialData = refreshed.credentials;
          credentialVersion = rotated.version;
          credentialExpiresAt = refreshed.expiresAt ?? credentialData.expiresAt ?? null;
          const now = new Date();
          const credentialRefId = current.credentialRefId;
          if (credentialRefId) {
            await this.db.transaction(async (tx) => {
              await tx.update(credentialVersions).set({ status: 'superseded' }).where(and(eq(credentialVersions.credentialRefId, credentialRefId), eq(credentialVersions.status, 'active')));
              await tx.insert(credentialVersions).values({
                id: newId(),
                credentialRefId,
                version: rotated.version,
                providerRef: rotated.ref,
                status: 'active',
                expiresAt: credentialExpiresAt ? new Date(credentialExpiresAt) : null,
                revokedAt: null,
                createdAt: now,
              });
              await tx.update(credentialRefs).set({
                currentVersion: rotated.version,
                status: 'active',
                rotatedAt: now,
                expiresAt: credentialExpiresAt ? new Date(credentialExpiresAt) : null,
                updatedAt: now,
              }).where(eq(credentialRefs.id, credentialRefId));
              await tx.update(connections).set({ status: 'connected', statusReason: null, lastErrorCode: null, expiresAt: credentialExpiresAt ? new Date(credentialExpiresAt) : null, updatedAt: now }).where(eq(connections.id, current.id));
            });
          }
        } catch (error) {
          const mapped = asConnectorError(error);
          await this.db.update(connections).set({
            status: mapped?.category === 'AUTH_REQUIRED' ? 'reauthorization_required' : 'provider_error',
            statusReason: mapped?.message ?? 'refresh_failed',
            lastErrorCode: mapped?.code ?? 'REFRESH_FAILED',
            updatedAt: new Date(),
          }).where(eq(connections.id, current.id));
          throw mapConnectorError(error);
        }
      }
    }
    return {
      capability: partial?.capability ?? 'VALIDATE_CONNECTION',
      input: partial?.input ?? {},
      requestId: partial?.requestId ?? `connection:${current.id}:validate`,
      idempotencyKey: partial?.idempotencyKey,
      providerIdempotencyKey: partial?.providerIdempotencyKey,
      operationId: partial?.operationId,
      userId,
      connectionId: current.id,
      connectorKey: current.connectorKey,
      credentials: {
        ref: current.credentialRef ?? undefined,
        version: credentialVersion,
        data: credentialData,
        expiresAt: credentialExpiresAt,
      },
    };
  }

  private async handleConnectorFailure(connectionId: string, error: unknown) {
    const connectorError = asConnectorError(error);
    if (!connectorError) return;
    const status = connectorError.category === 'AUTH_REQUIRED'
      ? 'reauthorization_required'
      : connectorError.category === 'RATE_LIMITED'
        ? 'degraded'
        : connectorError.category === 'PROVIDER_UNAVAILABLE'
          ? 'provider_error'
          : null;
    if (!status) return;
    await this.db.update(connections).set({
      status,
      statusReason: connectorError.message,
      lastErrorCode: connectorError.code,
      updatedAt: new Date(),
    }).where(eq(connections.id, connectionId));
  }
}

function mapHealthToConnectionStatus(status: 'healthy' | 'degraded' | 'unhealthy' | 'reauthorization_required' | 'rate_limited' | 'provider_unavailable') {
  switch (status) {
    case 'healthy':
      return 'connected';
    case 'degraded':
    case 'rate_limited':
      return 'degraded';
    case 'reauthorization_required':
      return 'reauthorization_required';
    case 'provider_unavailable':
    case 'unhealthy':
    default:
      return 'provider_error';
  }
}

function mapConnectorError(error: unknown) {
  const connectorError = asConnectorError(error);
  if (!connectorError) return error instanceof Error ? new BadRequestException(error.message) : new BadRequestException('Connector invocation failed');
  switch (connectorError.category) {
    case 'AUTH_REQUIRED':
    case 'PERMISSION_DENIED':
      return new ForbiddenException(connectorError.message);
    case 'NOT_FOUND':
      return new NotFoundException(connectorError.message);
    case 'CONFLICT':
      return new ConflictException(connectorError.message);
    default:
      return new BadRequestException({
        message: connectorError.message,
        code: connectorError.code,
        category: connectorError.category,
        retryable: connectorError.retryable,
        retryAfterMs: connectorError.retryAfterMs,
        providerCode: connectorError.providerCode,
        operationState: connectorError.operationState,
      });
  }
}

function asConnectorError(error: unknown): ConnectorError | null {
  if (!error || typeof error !== 'object') return null;
  if (error instanceof ConnectorError) return error;
  const candidate = error as Partial<ConnectorError> & { message?: unknown };
  if (typeof candidate.code !== 'string' || typeof candidate.category !== 'string' || typeof candidate.message !== 'string') return null;
  return {
    ...candidate,
    name: 'ConnectorError',
    retryable: Boolean(candidate.retryable),
    retryAfterMs: typeof candidate.retryAfterMs === 'number' ? candidate.retryAfterMs : null,
    providerCode: typeof candidate.providerCode === 'string' ? candidate.providerCode : null,
    operationState: candidate.operationState ?? null,
  } as ConnectorError;
}
