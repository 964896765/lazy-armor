import { Inject, Injectable } from '@nestjs/common';
import { logisticsTrackingSnapshots } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import type { LogisticsStatus } from './dto';

type LogisticsContext = Record<string, unknown>;

interface LogisticsSnapshotShape {
  trackingNumber: string;
  carrier: string;
  status: LogisticsStatus;
  latestEvent: string | null;
  latestEventAt: string | null;
  lastUpdatedAt: string;
  deliveredAt: string | null;
  sourceType: string;
}

@Injectable()
export class LogisticsService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async create(userId: string, input: {
    trackingNumber: string;
    carrier: string;
    status: LogisticsStatus;
    latestEvent?: string;
    latestEventAt?: string;
    lastUpdatedAt: string;
    deliveredAt?: string;
    sourceType: 'manual' | 'internal' | 'test';
  }) {
    const now = new Date();
    const id = newId();
    await this.db.insert(logisticsTrackingSnapshots).values({
      id,
      userId,
      trackingNumber: input.trackingNumber,
      carrier: input.carrier,
      status: input.status,
      latestEvent: input.latestEvent ?? null,
      latestEventAt: input.latestEventAt ? new Date(input.latestEventAt) : null,
      lastUpdatedAt: new Date(input.lastUpdatedAt),
      deliveredAt: input.deliveredAt ? new Date(input.deliveredAt) : null,
      sourceType: input.sourceType,
      metadataJson: null,
      createdAt: now,
      updatedAt: now,
    });
    return this.getById(userId, id);
  }

  async list(userId: string, trackingNumber?: string) {
    const filters = [eq(logisticsTrackingSnapshots.userId, userId)];
    if (trackingNumber) filters.push(eq(logisticsTrackingSnapshots.trackingNumber, trackingNumber));
    const rows = await this.db.select().from(logisticsTrackingSnapshots)
      .where(and(...filters))
      .orderBy(desc(logisticsTrackingSnapshots.lastUpdatedAt), desc(logisticsTrackingSnapshots.createdAt));
    return rows.map((row) => this.toResponse(row));
  }

  async resolveInternal(userId: string, config: Record<string, unknown>, context: LogisticsContext) {
    const trackingNumber = typeof config.trackingNumber === 'string' ? config.trackingNumber : typeof context.trackingNumber === 'string' ? context.trackingNumber : null;
    if (!trackingNumber) return this.enrichContext(context, config);
    const rows = await this.db.select().from(logisticsTrackingSnapshots)
      .where(and(eq(logisticsTrackingSnapshots.userId, userId), eq(logisticsTrackingSnapshots.trackingNumber, trackingNumber)))
      .orderBy(desc(logisticsTrackingSnapshots.lastUpdatedAt), desc(logisticsTrackingSnapshots.createdAt))
      .limit(1);
    return this.enrichContext({
      ...context,
      logisticsTrackingSnapshot: rows[0] ? this.toResponse(rows[0]) : null,
    }, config);
  }

  enrichContext(context: LogisticsContext, config: Record<string, unknown> = {}) {
    const snapshot = this.normalizeSnapshot(context.logisticsTrackingSnapshot ?? context);
    if (!snapshot) return context;
    const staleHours = typeof config.staleHours === 'number'
      ? config.staleHours
      : typeof context.staleHours === 'number'
        ? context.staleHours
        : null;
    const reference = typeof context.referenceDate === 'string' ? new Date(context.referenceDate) : new Date();
    const lastUpdated = new Date(snapshot.lastUpdatedAt);
    const hoursSinceUpdate = Number(((reference.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60)).toFixed(2));
    const delivered = snapshot.status === 'delivered' || Boolean(snapshot.deliveredAt);
    const stale = Boolean(staleHours && hoursSinceUpdate > staleHours);
    const explicitException = snapshot.status === 'exception';
    return {
      ...context,
      logisticsTrackingSnapshot: snapshot,
      trackingNumber: snapshot.trackingNumber,
      trackingNumberMasked: this.maskTrackingNumber(snapshot.trackingNumber),
      carrier: snapshot.carrier,
      currentStatus: snapshot.status,
      latestEventSummary: this.eventSummary(snapshot),
      latestEventAt: snapshot.latestEventAt,
      lastUpdatedAt: snapshot.lastUpdatedAt,
      deliveredAt: snapshot.deliveredAt,
      delivered,
      staleHours: staleHours ?? context.staleHours ?? null,
      hoursSinceUpdate,
      isException: explicitException || stale,
      stale,
      explicitException,
      sourceType: snapshot.sourceType,
    };
  }

  private async getById(userId: string, id: string) {
    const row = (await this.db.select().from(logisticsTrackingSnapshots)
      .where(and(eq(logisticsTrackingSnapshots.userId, userId), eq(logisticsTrackingSnapshots.id, id)))
      .limit(1))[0];
    return row ? this.toResponse(row) : null;
  }

  private normalizeSnapshot(value: unknown): LogisticsSnapshotShape | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (
      typeof row.trackingNumber !== 'string'
      || typeof row.carrier !== 'string'
      || typeof row.status !== 'string'
      || typeof row.lastUpdatedAt !== 'string'
      || typeof row.sourceType !== 'string'
    ) return null;
    return {
      trackingNumber: row.trackingNumber,
      carrier: row.carrier,
      status: row.status as LogisticsStatus,
      latestEvent: typeof row.latestEvent === 'string' ? row.latestEvent : null,
      latestEventAt: typeof row.latestEventAt === 'string' ? row.latestEventAt : null,
      lastUpdatedAt: row.lastUpdatedAt,
      deliveredAt: typeof row.deliveredAt === 'string' ? row.deliveredAt : null,
      sourceType: row.sourceType,
    };
  }

  private eventSummary(snapshot: LogisticsSnapshotShape) {
    if (snapshot.latestEvent) return snapshot.latestEvent;
    switch (snapshot.status) {
      case 'created':
        return '快递信息已创建';
      case 'in_transit':
        return '正在运输中';
      case 'out_for_delivery':
        return '正在派送';
      case 'delivered':
        return '已经签收';
      case 'exception':
        return '出现异常';
      default:
        return '等待更多物流信息';
    }
  }

  private maskTrackingNumber(value: string) {
    if (value.length <= 4) return value;
    return `${value.slice(0, 3)}***${value.slice(-4)}`;
  }

  private toResponse(row: typeof logisticsTrackingSnapshots.$inferSelect) {
    return {
      id: row.id,
      trackingNumber: row.trackingNumber,
      carrier: row.carrier,
      status: row.status as LogisticsStatus,
      latestEvent: row.latestEvent,
      latestEventAt: row.latestEventAt?.toISOString() ?? null,
      lastUpdatedAt: row.lastUpdatedAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      sourceType: row.sourceType,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
