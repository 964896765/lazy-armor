import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { connections, connectorCapabilities, plans, planVersions, temporaryAuthorizations } from '@lazy-armor/database';
import type { RiskLevel } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, gt, lte, or, isNull } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { RISK_SCORE } from '../risk/risk.types';

const MAX_AUTHORIZATION_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TemporaryAuthorizationService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService) {}

  async create(userId: string, input: { planVersionId: string; connectionId: string; capabilityKey?: string; actionType?: string; maximumRiskLevel: RiskLevel; amountLimitMinor?: number; currency?: string; validFrom?: string; expiresAt: string }) {
    if (input.maximumRiskLevel === 'R4') throw new BadRequestException('R4 cannot use Temporary Authorization');
    const now = new Date();
    const validFrom = input.validFrom ? new Date(input.validFrom) : now;
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(validFrom.getTime()) || validFrom.getTime() > now.getTime() + 60_000) throw new BadRequestException('validFrom cannot be in the future');
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= validFrom || expiresAt.getTime() > validFrom.getTime() + MAX_AUTHORIZATION_WINDOW_MS) throw new BadRequestException('expiresAt must be after validFrom and within a 24 hour window');
    const version = (await this.db.select({ id: planVersions.id, planId: planVersions.planId }).from(planVersions).innerJoin(plans, eq(planVersions.planId, plans.id))
      .where(and(eq(planVersions.id, input.planVersionId), eq(plans.userId, userId))).limit(1))[0];
    if (!version) throw new NotFoundException('PlanVersion not found');
    const connection = (await this.db.select({ id: connections.id, connectorId: connections.connectorId }).from(connections).where(and(eq(connections.id, input.connectionId), eq(connections.userId, userId))).limit(1))[0];
    if (!connection) throw new NotFoundException('Connection not found');
    if (input.capabilityKey) {
      const capability = (await this.db.select({ id: connectorCapabilities.id }).from(connectorCapabilities).where(and(eq(connectorCapabilities.connectorId, connection.connectorId), eq(connectorCapabilities.key, input.capabilityKey))).limit(1))[0];
      if (!capability) throw new NotFoundException('Capability is not available on the bound Connection');
    }
    if (input.amountLimitMinor !== undefined && (!Number.isInteger(input.amountLimitMinor) || input.amountLimitMinor < 0)) throw new BadRequestException('amountLimitMinor must be a non-negative integer');
    if (input.currency && !/^[A-Z]{3}$/.test(input.currency)) throw new BadRequestException('currency must be an uppercase ISO code');
    const row = { id: newId(), userId, planId: version.planId, planVersionId: input.planVersionId, connectionId: input.connectionId, capabilityKey: input.capabilityKey ?? null, actionType: input.actionType ?? null, maximumRiskLevel: input.maximumRiskLevel, amountLimitMinor: input.amountLimitMinor ?? null, currency: input.currency ?? null, validFrom, status: 'active', expiresAt, revokedAt: null, createdAt: now, updatedAt: now };
    await this.db.insert(temporaryAuthorizations).values(row);
    await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'TEMPORARY_AUTHORIZATION_CREATED', resourceType: 'temporary_authorization', resourceId: row.id, userId, correlationId: input.planVersionId, changeSummary: `Temporary authorization created up to ${input.maximumRiskLevel} for plan version ${input.planVersionId}`, source: 'api', result: 'success' });
    return row;
  }

  list(userId: string) { return this.db.select().from(temporaryAuthorizations).where(eq(temporaryAuthorizations.userId, userId)).orderBy(desc(temporaryAuthorizations.createdAt)); }

  async revoke(userId: string, id: string) {
    let result: typeof temporaryAuthorizations.$inferSelect | undefined;
    await this.db.transaction(async (tx) => {
      const row = (await tx.select().from(temporaryAuthorizations).where(and(eq(temporaryAuthorizations.id, id), eq(temporaryAuthorizations.userId, userId))).limit(1).for('update'))[0];
      if (!row) throw new NotFoundException('Temporary Authorization not found');
      if (row.status === 'revoked') { result = row; return; }
      const now = new Date();
      await tx.update(temporaryAuthorizations).set({ status: 'revoked', revokedAt: now, updatedAt: now }).where(eq(temporaryAuthorizations.id, id));
      result = { ...row, status: 'revoked', revokedAt: now, updatedAt: now };
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'TEMPORARY_AUTHORIZATION_REVOKED', resourceType: 'temporary_authorization', resourceId: id, userId, correlationId: row.planVersionId, changeSummary: `Temporary authorization ${id} revoked`, source: 'api', result: 'success' }, tx);
    });
    return result!;
  }

  async match(input: { userId: string; planVersionId: string; connectionId: string | null; capabilityKey: string | null; actionType: string | null; risk: RiskLevel; amountMinor: number | null; currency: string | null }) {
    if (input.risk === 'R4') return null;
    const now = new Date();
    const candidates = await this.db.select().from(temporaryAuthorizations).where(and(
      eq(temporaryAuthorizations.userId, input.userId), eq(temporaryAuthorizations.planVersionId, input.planVersionId),
      eq(temporaryAuthorizations.status, 'active'), gt(temporaryAuthorizations.expiresAt, now),
      or(isNull(temporaryAuthorizations.validFrom), lte(temporaryAuthorizations.validFrom, now)),
      eq(temporaryAuthorizations.connectionId, input.connectionId ?? '00000000-0000-0000-0000-000000000000'),
    )).orderBy(desc(temporaryAuthorizations.createdAt));
    return candidates.find((candidate) => {
      if ((candidate.capabilityKey ?? null) !== (input.capabilityKey ?? null)) return false;
      if (candidate.actionType !== null && candidate.actionType !== input.actionType) return false;
      if (RISK_SCORE[input.risk] > RISK_SCORE[candidate.maximumRiskLevel as RiskLevel]) return false;
      if (candidate.amountLimitMinor !== null && (input.amountMinor === null || input.amountMinor > candidate.amountLimitMinor)) return false;
      if (candidate.currency && candidate.currency !== input.currency) return false;
      return true;
    }) ?? null;
  }
}
