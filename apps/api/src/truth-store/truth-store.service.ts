import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mobileNotificationReceipts, planVersions, truthFactDependencies, truthProvenance, truthRecords, truthRecordVersions } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { resolveMobileCandidateSpec, type JsonValue, type ParserKey } from '@lazy-armor/plan-schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { RealityPipelineService } from '../reality-pipeline/reality-pipeline.service';

interface CandidateSnapshot {
  schema?: unknown;
  candidateKind?: unknown;
  candidateResource?: unknown;
  candidateConfidence?: unknown;
  currency?: unknown;
  candidateStatus?: unknown;
  parserVersion?: unknown;
}

@Injectable()
export class TruthStoreService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService, private readonly realityPipeline: RealityPipelineService) {}

  async confirmMobileReceipt(userId: string, receipt: typeof mobileNotificationReceipts.$inferSelect) {
    const candidate = this.candidateSpecFrom(receipt);
    const existing = await this.findByReceipt(this.db, userId, receipt.id);
    if (existing) return this.completedResponse(existing);

    // A receipt is only an audit record; the fact must always flow through the
    // generic reality pipeline (Observation → Candidate → Truth). There is no
    // direct receipt-to-Truth path.
    const evidenceHash = hash({ receiptId: receipt.id, payloadHash: receipt.payloadHash, candidateResource: candidate.candidateResource, parserVersion: 'generic-notification-v1' });
    const normalized = await this.realityPipeline.ingest(userId, {
      sourceMode: 'NOTIFICATION', providerKey: receipt.sourcePackage, connectionId: null,
      externalEventKey: receipt.id, parserKey: candidate.parserId, resourceHint: candidate.resourceHint,
      payload: candidate.payload, evidenceHash,
      observedAt: receipt.receivedAt.toISOString(), occurredAt: receipt.postedAt.toISOString(),
    });
    const candidateId = normalized.candidates[0]?.id;
    if (!candidateId) throw new ConflictException('Notification observation produced no candidate fact');
    const result = await this.realityPipeline.confirmCandidate(userId, candidateId, { sourceReceiptId: receipt.id, verifiedBy: 'user_confirmation', verificationMethod: 'user_confirmation_after_device_key_proof' });
    await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'TRUTH_RECORD_VERIFIED', resourceType: 'truth_record', resourceId: result.id, userId, correlationId: receipt.id, changeSummary: 'Confirmed a mobile fact through the generic reality pipeline adapter', source: 'api', result: 'success' });
    return result;
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

  /**
   * finance.accounting 账目整理的交易事实来源：读取已确认（verified）的
   * finance.transaction.amount Truth，绝不读取 PENDING 候选或未验证数据。
   * 返回结构在 context 中供 classify / summarize / compare 动作使用。
   */
  async resolveFinanceTransactions(userId: string, context: Record<string, unknown>) {
    const rows = await this.db.select({
      truthId: truthRecords.id,
      subjectKey: truthRecords.subjectKey,
      verifiedAt: truthRecords.verifiedAt,
      value: truthRecordVersions.valueJson,
    }).from(truthRecords).innerJoin(truthRecordVersions, eq(truthRecords.currentVersionId, truthRecordVersions.id))
      .where(and(eq(truthRecords.userId, userId), eq(truthRecords.status, 'verified'), eq(truthRecords.resourceKey, 'finance.transaction')))
      .orderBy(desc(truthRecords.verifiedAt));
    const transactions = rows.flatMap((row) => {
      const wrapped = row.value as Record<string, unknown>;
      const inner = (wrapped.value ?? wrapped) as Record<string, unknown>;
      return [{
        truthRecordId: row.truthId,
        subjectKey: row.subjectKey,
        amountMinor: typeof inner.amountMinor === 'number' ? inner.amountMinor : null,
        currency: typeof inner.currency === 'string' ? inner.currency : null,
        accountKey: typeof inner.accountKey === 'string' ? inner.accountKey : null,
        transactionId: typeof inner.transactionId === 'string' ? inner.transactionId : null,
        relatedTransactionId: typeof inner.relatedTransactionId === 'string' ? inner.relatedTransactionId : null,
        merchant: typeof inner.merchant === 'string' ? inner.merchant : null,
        direction: typeof inner.direction === 'string' ? inner.direction : null,
        transactionState: typeof inner.transactionState === 'string' ? inner.transactionState : null,
        occurredAt: typeof wrapped.occurredAt === 'string' ? wrapped.occurredAt : row.verifiedAt.toISOString(),
        verifiedAt: row.verifiedAt.toISOString(),
      }];
    }).filter((tx) => tx.amountMinor !== null && tx.currency !== null);
    return {
      ...context,
      financeTransactions: transactions,
      financeTransactionCount: transactions.length,
      // This is explicitly the scope actually available to this execution,
      // not a claim that every user account has been reconciled.
      financeAccountKeys: [...new Set(transactions.map((tx) => tx.accountKey).filter((key): key is string => Boolean(key)))],
    };
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

  private candidateSpecFrom(receipt: typeof mobileNotificationReceipts.$inferSelect): { parserId: ParserKey; resourceHint: string; candidateResource: string; payload: Record<string, JsonValue> } {
    const snapshot = receipt.snapshotJson as CandidateSnapshot;
    if (snapshot.schema !== 'mobile-notification-minimal-v2' || snapshot.parserVersion !== 'generic-notification-v1') {
      throw new BadRequestException('This notification candidate cannot become a verified fact');
    }
    const spec = resolveMobileCandidateSpec(typeof snapshot.candidateKind === 'string' ? snapshot.candidateKind : '');
    if (!spec) throw new BadRequestException('This notification candidate cannot become a verified fact');

    if (spec.candidateKind === 'transaction') {
      if (!Number.isSafeInteger(receipt.amountMinor) || (receipt.amountMinor as number) < 0 || snapshot.currency !== 'CNY') {
        throw new BadRequestException('This notification candidate cannot become a verified fact');
      }
      const payload: Record<string, JsonValue> = { subjectKey: receipt.id, amountMinor: receipt.amountMinor as number, currency: 'CNY' };
      return { parserId: spec.parserId, resourceHint: spec.resourceHint, candidateResource: 'mobile.billing.transaction', payload };
    }

    const status = typeof snapshot.candidateStatus === 'string' && snapshot.candidateStatus ? snapshot.candidateStatus : null;
    if (!status) throw new BadRequestException('This notification candidate is missing its normalized status');
    const payload: Record<string, JsonValue> = { subjectKey: receipt.id, status };
    return { parserId: spec.parserId, resourceHint: spec.resourceHint, candidateResource: String(snapshot.candidateResource ?? spec.resourceHint), payload };
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
