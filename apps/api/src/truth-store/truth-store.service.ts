import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mobileNotificationReceipts, planVersions, truthFactDependencies, truthProvenance, truthRecords, truthRecordVersions } from '@lazy-armor/database';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { newId } from '@lazy-armor/shared';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { RealityPipelineService } from '../reality-pipeline/reality-pipeline.service';

interface CandidateSnapshot {
  schema?: unknown;
  candidateKind?: unknown;
  candidateResource?: unknown;
  candidateConfidence?: unknown;
  currency?: unknown;
  parserVersion?: unknown;
}

@Injectable()
export class TruthStoreService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService, @Optional() private readonly realityPipeline?: RealityPipelineService) {}

  async confirmMobileReceipt(userId: string, receipt: typeof mobileNotificationReceipts.$inferSelect) {
    const candidate = this.candidateFrom(receipt);
    const existing = await this.findByReceipt(this.db, userId, receipt.id);
    if (existing) return this.completedResponse(existing);

    if (this.realityPipeline) {
      const evidenceHash = hash({ receiptId: receipt.id, payloadHash: receipt.payloadHash, candidateResource: candidate.resource, parserVersion: candidate.parserVersion });
      const normalized = await this.realityPipeline.ingest(userId, {
        sourceMode: 'NOTIFICATION', providerKey: receipt.sourcePackage, connectionId: null,
        externalEventKey: receipt.id, parserKey: 'mobile-notification-billing.v1', resourceHint: 'finance.transaction',
        payload: { subjectKey: receipt.id, amountMinor: receipt.amountMinor as number, currency: candidate.currency }, evidenceHash,
        observedAt: receipt.receivedAt.toISOString(), occurredAt: receipt.postedAt.toISOString(),
      });
      const candidateId = normalized.candidates[0]?.id;
      if (!candidateId) throw new ConflictException('Notification observation produced no candidate fact');
      const result = await this.realityPipeline.confirmCandidate(userId, candidateId, { sourceReceiptId: receipt.id, verifiedBy: 'user_confirmation', verificationMethod: 'user_confirmation_after_device_key_proof' });
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'TRUTH_RECORD_VERIFIED', resourceType: 'truth_record', resourceId: result.id, userId, correlationId: receipt.id, changeSummary: 'Confirmed a mobile billing fact through the generic reality pipeline adapter', source: 'api', result: 'success' });
      return result;
    }

    const now = new Date();
    const truthId = newId();
    const versionId = newId();
    const value = { resource: candidate.resource, amountMinor: receipt.amountMinor, currency: candidate.currency, occurredAt: receipt.postedAt.toISOString() };
    const valueHash = hash(value);
    const evidenceHash = hash({ receiptId: receipt.id, payloadHash: receipt.payloadHash, candidateResource: candidate.resource, parserVersion: candidate.parserVersion });

    let result: { created: true } | { created: false; row: typeof truthRecords.$inferSelect };
    try {
      result = await this.db.transaction(async (tx) => {
        const raced = await this.findByReceipt(tx, userId, receipt.id);
        if (raced) return { created: false as const, row: raced };
        await tx.insert(truthRecords).values({
          id: truthId, userId, resourceKey: candidate.resource, subjectKey: receipt.id, status: 'verified', currentVersionId: null,
          sourceReceiptId: receipt.id, verifiedBy: 'user_confirmation', verifiedAt: now, revokedAt: null, createdAt: now, updatedAt: now,
        });
        await tx.insert(truthRecordVersions).values({
          id: versionId, truthRecordId: truthId, versionNumber: 1, valueJson: value, valueHash, verificationMethod: 'user_confirmation_after_device_key_proof', evidenceHash, createdAt: now,
        });
        await tx.update(truthRecords).set({ currentVersionId: versionId, updatedAt: now }).where(eq(truthRecords.id, truthId));
        return { created: true as const };
      });
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      const raced = await this.findByReceipt(this.db, userId, receipt.id);
      if (!raced) throw new ConflictException('Truth record confirmation conflicted; retry safely');
      return this.completedResponse(raced);
    }

    if (!result.created) return this.completedResponse(result.row);
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'TRUTH_RECORD_VERIFIED', resourceType: 'truth_record', resourceId: truthId,
      userId, correlationId: receipt.id, changeSummary: `Confirmed a brand-neutral ${candidate.resource} fact from a device notification candidate`, source: 'api', result: 'success',
    });
    return { id: truthId, resourceKey: candidate.resource, status: 'verified', verifiedAt: now.toISOString(), currentVersion: { versionNumber: 1, value } };
  }

  async resolveMobileBillingTransactions(userId: string, context: Record<string, unknown>) {
    const rows = await this.db.select({
      truthId: truthRecords.id, resourceKey: truthRecords.resourceKey, verifiedAt: truthRecords.verifiedAt, value: truthRecordVersions.valueJson,
    }).from(truthRecords).innerJoin(truthRecordVersions, eq(truthRecords.currentVersionId, truthRecordVersions.id))
      .where(and(eq(truthRecords.userId, userId), eq(truthRecords.status, 'verified'), eq(truthRecords.resourceKey, 'mobile.billing.transaction')))
      .orderBy(desc(truthRecords.verifiedAt));
    const transactions = rows.map((row) => {
      const value = row.value as Record<string, unknown>;
      return {
        truthRecordId: row.truthId,
        amountMinor: typeof value.amountMinor === 'number' ? value.amountMinor : null,
        currency: value.currency === 'CNY' ? 'CNY' : null,
        occurredAt: typeof value.occurredAt === 'string' ? value.occurredAt : row.verifiedAt.toISOString(),
        verifiedAt: row.verifiedAt.toISOString(),
      };
    }).filter((value) => value.amountMinor !== null && value.currency === 'CNY');
    return { ...context, mobileBillingTransactions: transactions, mobileBillingTotalMinor: transactions.reduce((total, item) => total + (item.amountMinor ?? 0), 0) };
  }

  async get(userId: string, id: string) {
    const record = (await this.db.select().from(truthRecords)
      .where(and(eq(truthRecords.id, id), eq(truthRecords.userId, userId), eq(truthRecords.status, 'verified')))
      .limit(1))[0];
    if (!record) throw new NotFoundException('Truth record not found');
    const versions = await this.db.select({
      id: truthRecordVersions.id,
      versionNumber: truthRecordVersions.versionNumber,
      valueHash: truthRecordVersions.valueHash,
      verificationMethod: truthRecordVersions.verificationMethod,
      evidenceHash: truthRecordVersions.evidenceHash,
      createdAt: truthRecordVersions.createdAt,
    }).from(truthRecordVersions)
      .where(eq(truthRecordVersions.truthRecordId, record.id))
      .orderBy(desc(truthRecordVersions.versionNumber));
    const provenance = versions.length === 0 ? [] : await this.db.select({
      truthRecordVersionId: truthProvenance.truthRecordVersionId,
      providerKey: truthProvenance.providerKey,
      sourceMode: truthProvenance.sourceMode,
      evidenceHash: truthProvenance.evidenceHash,
      observedAt: truthProvenance.observedAt,
      createdAt: truthProvenance.createdAt,
    }).from(truthProvenance)
      .innerJoin(truthRecordVersions, eq(truthProvenance.truthRecordVersionId, truthRecordVersions.id))
      .innerJoin(truthRecords, eq(truthRecordVersions.truthRecordId, truthRecords.id))
      .where(and(eq(truthRecords.id, record.id), eq(truthRecords.userId, userId)))
      .orderBy(desc(truthProvenance.createdAt));
    return {
      ...this.toResponse(record),
      subjectKey: record.subjectKey,
      versions: versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() })),
      provenance: provenance.map((item) => ({ ...item, observedAt: item.observedAt.toISOString(), createdAt: item.createdAt.toISOString() })),
    };
  }

  async list(userId: string, resourceKey?: string) {
    const baseWhere = resourceKey
      ? and(eq(truthRecords.userId, userId), eq(truthRecords.resourceKey, resourceKey), eq(truthRecords.status, 'verified'))
      : and(eq(truthRecords.userId, userId), eq(truthRecords.status, 'verified'));
    const rows = await this.db.select({ record: truthRecords, version: truthRecordVersions })
      .from(truthRecords)
      .innerJoin(truthRecordVersions, eq(truthRecords.currentVersionId, truthRecordVersions.id))
      .where(baseWhere)
      .orderBy(desc(truthRecords.verifiedAt));
    const versionIds = rows.map((row) => row.version.id);
    const provenance = versionIds.length === 0 ? [] : await this.db.select().from(truthProvenance).where(inArray(truthProvenance.truthRecordVersionId, versionIds));
    const provenanceByVersion = new Map(provenance.map((item) => [item.truthRecordVersionId, item]));
    const planNamesByDependency = await this.planNamesByDependency(userId);
    return rows.map(({ record, version }) => this.toPresentationRow(record, version, provenanceByVersion.get(version.id), planNamesByDependency));
  }

  /**
   * 反向 plan-usage：读取哪些计划依赖某一 factKey/resourceType。仅做只读投影，
   * 不改变 Truth 的验证语义。依赖键按 userId + factKey + resourceType 匹配。
   */
  private async planNamesByDependency(userId: string) {
    const deps = await this.db.select({
      factKey: truthFactDependencies.factKey,
      resourceType: truthFactDependencies.resourceType,
      planName: planVersions.name,
    }).from(truthFactDependencies)
      .innerJoin(planVersions, eq(truthFactDependencies.planVersionId, planVersions.id))
      .where(eq(truthFactDependencies.userId, userId));
    const byKey = new Map<string, Set<string>>();
    for (const dep of deps) {
      const key = `${dep.factKey}\u0000${dep.resourceType}`;
      const names = byKey.get(key) ?? new Set<string>();
      names.add(dep.planName);
      byKey.set(key, names);
    }
    return byKey;
  }

  private toPresentationRow(
    record: typeof truthRecords.$inferSelect,
    version: typeof truthRecordVersions.$inferSelect,
    provenance?: typeof truthProvenance.$inferSelect,
    planNamesByDependency = new Map<string, Set<string>>(),
  ) {
    const value = (version.valueJson ?? {}) as Record<string, unknown>;
    const factKey = typeof value.factKey === 'string' ? value.factKey : record.resourceKey;
    const resourceType = typeof value.resourceType === 'string' ? value.resourceType : record.resourceKey;
    const planNames = planNamesByDependency.get(`${factKey}\u0000${resourceType}`);
    return {
      ...this.toResponse(record),
      factKey,
      resourceType,
      valueSummary: truthValueSummary(value),
      sourceLabel: provenance?.providerKey ?? (typeof value.sourceMode === 'string' ? value.sourceMode : 'user_confirmation'),
      observedAt: provenance?.observedAt.toISOString() ?? (typeof value.observedAt === 'string' ? value.observedAt : record.verifiedAt.toISOString()),
      realityLevel: typeof value.realityLevel === 'string' ? value.realityLevel : 'VERIFIED',
      usedByPlanNames: planNames ? [...planNames] : [],
    };
  }

  private async findByReceipt(db: Pick<InjectedDatabase, 'select'>, userId: string, receiptId: string) {
    return (await db.select().from(truthRecords).where(and(eq(truthRecords.userId, userId), eq(truthRecords.sourceReceiptId, receiptId))).limit(1))[0];
  }

  private completedResponse(row: typeof truthRecords.$inferSelect) {
    if (row.status !== 'verified' || !row.currentVersionId) {
      throw new ConflictException('Truth record is incomplete and cannot be consumed; manual recovery is required');
    }
    return this.toResponse(row);
  }

  private candidateFrom(receipt: typeof mobileNotificationReceipts.$inferSelect) {
    const snapshot = receipt.snapshotJson as CandidateSnapshot;
    if (snapshot.schema !== 'mobile-notification-minimal-v2' || snapshot.candidateKind !== 'billing_transaction_candidate' || snapshot.candidateResource !== 'mobile.billing.transaction' || snapshot.currency !== 'CNY' || snapshot.parserVersion !== 'generic-notification-v1' || !Number.isSafeInteger(receipt.amountMinor) || (receipt.amountMinor as number) < 0) {
      throw new BadRequestException('This notification candidate cannot become a verified fact');
    }
    return { resource: 'mobile.billing.transaction', currency: 'CNY', parserVersion: 'generic-notification-v1' } as const;
  }

  private toResponse(row: typeof truthRecords.$inferSelect) {
    return { id: row.id, resourceKey: row.resourceKey, status: row.status, sourceReceiptId: row.sourceReceiptId, verifiedBy: row.verifiedBy, verifiedAt: row.verifiedAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null, currentVersionId: row.currentVersionId };
  }
}

function truthValueSummary(valueJson: Record<string, unknown>): string {
  const inner = valueJson.value;
  if (inner === undefined || inner === null) {
    const amountMinor = valueJson.amountMinor;
    const currency = valueJson.currency;
    if (typeof amountMinor === 'number') return currency === 'CNY' ? `¥${(amountMinor / 100).toFixed(2)}` : String(amountMinor);
    return '—';
  }
  if (typeof inner === 'string' || typeof inner === 'number' || typeof inner === 'boolean') return String(inner);
  if (typeof inner === 'object') {
    const record = inner as Record<string, unknown>;
    const amountMinor = record.amountMinor;
    const currency = record.currency;
    if (typeof amountMinor === 'number') return currency === 'CNY' ? `¥${(amountMinor / 100).toFixed(2)}` : String(amountMinor);
    for (const [key, entry] of Object.entries(record)) {
      if (typeof entry === 'string' || typeof entry === 'number') return `${key}: ${entry}`;
    }
    return JSON.stringify(record);
  }
  return '—';
}

function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function isDuplicate(error: unknown) {
  // Drizzle 会将 mysql2 的错误包裹为 DrizzleQueryError；真实并发路径的
  // ER_DUP_ENTRY 位于 cause，而非最外层错误对象。仅识别该精确数据库码，
  // 然后重新读取已提交的完整事实，绝不将其他写入错误降级为成功。
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return candidate?.code === 'ER_DUP_ENTRY' || candidate?.cause?.code === 'ER_DUP_ENTRY';
}
