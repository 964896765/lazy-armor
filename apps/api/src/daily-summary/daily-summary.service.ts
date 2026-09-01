import { Inject, Injectable } from '@nestjs/common';
import { importantItemCandidates } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ConnectionsService } from '../connections/connections.service';
import { IMPORTANT_ITEM_SOURCE_TYPES, type ImportantItemSourceType } from './dto';

type DailySummaryContext = Record<string, unknown>;

interface ImportantItemCandidateShape {
  id?: string;
  sourceType: ImportantItemSourceType;
  sourceId: string;
  title: string;
  summary: string;
  occurredAt: string;
  dueAt: string | null;
  senderOrOrganizer: string | null;
  category: string;
  importanceSignals: Record<string, unknown>;
  requiresAction: boolean;
}

@Injectable()
export class DailySummaryService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly connections: ConnectionsService,
  ) {}

  async createCandidate(userId: string, input: {
    sourceType: ImportantItemSourceType;
    sourceId: string;
    title: string;
    summary: string;
    occurredAt: string;
    dueAt?: string;
    senderOrOrganizer?: string;
    category: string;
    importanceSignals?: Record<string, unknown>;
    requiresAction?: boolean;
  }) {
    const now = new Date();
    await this.db.insert(importantItemCandidates).values({
      id: newId(),
      userId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
      summary: input.summary,
      occurredAt: new Date(input.occurredAt),
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      senderOrOrganizer: input.senderOrOrganizer ?? null,
      category: input.category,
      importanceSignalsJson: input.importanceSignals ?? {},
      requiresAction: input.requiresAction ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    }).onDuplicateKeyUpdate({
      set: {
        title: input.title,
        summary: input.summary,
        occurredAt: new Date(input.occurredAt),
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        senderOrOrganizer: input.senderOrOrganizer ?? null,
        category: input.category,
        importanceSignalsJson: input.importanceSignals ?? {},
        requiresAction: input.requiresAction ? 1 : 0,
        updatedAt: now,
      },
    });
    const row = (await this.db.select().from(importantItemCandidates)
      .where(and(eq(importantItemCandidates.userId, userId), eq(importantItemCandidates.sourceType, input.sourceType), eq(importantItemCandidates.sourceId, input.sourceId)))
      .limit(1))[0];
    return row ? this.candidateResponse(row) : null;
  }

  async listCandidates(userId: string, sourceType?: ImportantItemSourceType) {
    const filters = [eq(importantItemCandidates.userId, userId)];
    if (sourceType) filters.push(eq(importantItemCandidates.sourceType, sourceType));
    const rows = await this.db.select().from(importantItemCandidates)
      .where(and(...filters))
      .orderBy(desc(importantItemCandidates.createdAt));
    return rows.map((row) => this.candidateResponse(row));
  }

  async resolveInternal(userId: string, config: Record<string, unknown>, context: DailySummaryContext) {
    const emailConnectionId = typeof config.emailConnectionId === 'string' ? config.emailConnectionId : null;
    const calendarConnectionId = typeof config.calendarConnectionId === 'string' ? config.calendarConnectionId : null;
    const remoteCandidates = [
      ...(emailConnectionId ? await this.syncConnectionSource(userId, { connectionId: emailConnectionId, sourceType: 'email' }) : []),
      ...(calendarConnectionId ? await this.syncConnectionSource(userId, { connectionId: calendarConnectionId, sourceType: 'calendar' }) : []),
    ];
    const includedSources = this.readIncludedSources(config.includedSources ?? context.includedSources);
    const rows = await this.db.select().from(importantItemCandidates)
      .where(eq(importantItemCandidates.userId, userId))
      .orderBy(desc(importantItemCandidates.createdAt));
    return this.enrichContext({
      ...context,
      importantItemCandidates: [...remoteCandidates, ...rows.map((row) => this.candidateResponse(row))].filter((row) => includedSources.length === 0 || includedSources.includes(row.sourceType)),
      includedSources,
      lookAheadHours: typeof config.lookAheadHours === 'number' ? config.lookAheadHours : context.lookAheadHours,
      includeCalendar: typeof config.includeCalendar === 'boolean' ? config.includeCalendar : context.includeCalendar,
      includeMessages: typeof config.includeMessages === 'boolean' ? config.includeMessages : context.includeMessages,
      maxItems: typeof config.maxItems === 'number' ? config.maxItems : context.maxItems,
    });
  }

  enrichContext(context: DailySummaryContext) {
    const candidates = this.normalizeCandidates(context.importantItemCandidates);
    if (candidates.length === 0) return context;
    const deduped = Array.from(new Map(candidates.map((item) => [`${item.sourceType}:${item.sourceId}`, item])).values());
    return {
      ...context,
      importantItemCandidates: deduped,
      includedSources: this.readIncludedSources(context.includedSources),
      lookAheadHours: typeof context.lookAheadHours === 'number' ? context.lookAheadHours : 24,
      includeCalendar: typeof context.includeCalendar === 'boolean' ? context.includeCalendar : true,
      includeMessages: typeof context.includeMessages === 'boolean' ? context.includeMessages : true,
      maxItems: typeof context.maxItems === 'number' ? context.maxItems : 5,
    };
  }

  summarize(context: DailySummaryContext, config: Record<string, unknown>) {
    const enriched = this.enrichContext(context);
    const candidates = this.normalizeCandidates(enriched.importantItemCandidates);
    const includedSources = this.readIncludedSources(config.includedSources ?? enriched.includedSources);
    const lookAheadHours = typeof (config.lookAheadHours ?? enriched.lookAheadHours) === 'number'
      ? Number(config.lookAheadHours ?? enriched.lookAheadHours)
      : 24;
    const includeCalendar = typeof (config.includeCalendar ?? enriched.includeCalendar) === 'boolean'
      ? Boolean(config.includeCalendar ?? enriched.includeCalendar)
      : true;
    const includeMessages = typeof (config.includeMessages ?? enriched.includeMessages) === 'boolean'
      ? Boolean(config.includeMessages ?? enriched.includeMessages)
      : true;
    const maxItems = typeof (config.maxItems ?? enriched.maxItems) === 'number'
      ? Number(config.maxItems ?? enriched.maxItems)
      : 5;
    const reference = typeof enriched.referenceDate === 'string' ? new Date(enriched.referenceDate) : new Date();
    const endOfToday = new Date(reference);
    endOfToday.setUTCHours(23, 59, 59, 999);
    const lookAheadLimit = new Date(reference.getTime() + lookAheadHours * 60 * 60 * 1000);
    const filtered = candidates.filter((candidate) => {
      if (includedSources.length > 0 && !includedSources.includes(candidate.sourceType)) return false;
      if (!includeCalendar && (candidate.sourceType === 'manual_event' || candidate.sourceType === 'test_calendar' || candidate.sourceType === 'calendar')) return false;
      if (!includeMessages && (candidate.sourceType === 'test_email' || candidate.sourceType === 'email')) return false;
      return true;
    });
    const buckets = { mustHandle: [] as ImportantItemCandidateShape[], shouldHandle: [] as ImportantItemCandidateShape[], ignored: [] as ImportantItemCandidateShape[] };
    for (const candidate of filtered) {
      const bucket = this.bucketCandidate(candidate, reference, endOfToday, lookAheadLimit);
      buckets[bucket].push(candidate);
    }
    const topItems = [...buckets.mustHandle, ...buckets.shouldHandle].slice(0, maxItems).map((item) => ({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      title: item.title,
      dueAt: item.dueAt,
      bucket: buckets.mustHandle.some((candidate) => candidate.sourceType === item.sourceType && candidate.sourceId === item.sourceId) ? 'must_handle' : 'should_handle',
    }));
    const sourceCounts = filtered.reduce<Record<string, number>>((acc, item) => {
      acc[item.sourceType] = (acc[item.sourceType] ?? 0) + 1;
      return acc;
    }, {});
    return {
      generatedAt: reference.toISOString(),
      mustHandleCount: buckets.mustHandle.length,
      shouldHandleCount: buckets.shouldHandle.length,
      ignoredCount: buckets.ignored.length,
      mustHandle: buckets.mustHandle,
      shouldHandle: buckets.shouldHandle,
      ignored: buckets.ignored,
      topItems,
      sourceCounts,
    };
  }

  sourceLabel(sourceType: string) {
    switch (sourceType) {
      case 'internal_task':
        return '内部事项';
      case 'manual_event':
        return '手动事件';
      case 'test_email':
        return '测试邮件';
      case 'test_calendar':
        return '测试日历';
      case 'email':
        return '邮件';
      case 'calendar':
        return '日历';
      default:
        return sourceType;
    }
  }

  private bucketCandidate(
    candidate: ImportantItemCandidateShape,
    reference: Date,
    endOfToday: Date,
    lookAheadLimit: Date,
  ): 'mustHandle' | 'shouldHandle' | 'ignored' {
    const dueAt = candidate.dueAt ? new Date(candidate.dueAt) : null;
    const occurredAt = new Date(candidate.occurredAt);
    const signals = candidate.importanceSignals;
    const markedImportant = Boolean(signals.markedImportant);
    const highPriority = Boolean(signals.highPriority);
    const needsReply = Boolean(signals.needsReply);
    const calendarLike = candidate.sourceType === 'manual_event' || candidate.sourceType === 'test_calendar' || candidate.sourceType === 'calendar';
    const calendarSoon = calendarLike
      && occurredAt >= reference
      && occurredAt.getTime() - reference.getTime() <= 4 * 60 * 60 * 1000;
    const calendarLaterToday = calendarLike
      && occurredAt > reference
      && occurredAt <= endOfToday
      && !calendarSoon;
    const dueToday = !calendarLike && dueAt !== null && dueAt <= endOfToday;
    const dueSoon = !calendarLike && dueAt !== null && dueAt > endOfToday && dueAt <= lookAheadLimit;
    if (dueToday || calendarSoon) return 'mustHandle';
    if (calendarLaterToday) return 'shouldHandle';
    if (dueSoon || markedImportant || highPriority || candidate.requiresAction) return 'shouldHandle';
    if (needsReply) return 'shouldHandle';
    return 'ignored';
  }

  private readIncludedSources(value: unknown): ImportantItemSourceType[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ImportantItemSourceType => typeof item === 'string' && IMPORTANT_ITEM_SOURCE_TYPES.includes(item as ImportantItemSourceType));
  }

  private normalizeCandidates(value: unknown): ImportantItemCandidateShape[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      if (
        typeof row.sourceType !== 'string'
        || !IMPORTANT_ITEM_SOURCE_TYPES.includes(row.sourceType as ImportantItemSourceType)
        || typeof row.sourceId !== 'string'
        || typeof row.title !== 'string'
        || typeof row.summary !== 'string'
        || typeof row.occurredAt !== 'string'
        || typeof row.category !== 'string'
      ) return [];
      return [{
        id: typeof row.id === 'string' ? row.id : undefined,
        sourceType: row.sourceType as ImportantItemSourceType,
        sourceId: row.sourceId,
        title: row.title,
        summary: row.summary,
        occurredAt: row.occurredAt,
        dueAt: typeof row.dueAt === 'string' ? row.dueAt : null,
        senderOrOrganizer: typeof row.senderOrOrganizer === 'string' ? row.senderOrOrganizer : null,
        category: row.category,
        importanceSignals: row.importanceSignals && typeof row.importanceSignals === 'object' && !Array.isArray(row.importanceSignals)
          ? row.importanceSignals as Record<string, unknown>
          : {},
        requiresAction: Boolean(row.requiresAction),
      }];
    });
  }

  private candidateResponse(row: typeof importantItemCandidates.$inferSelect) {
    return {
      id: row.id,
      sourceType: row.sourceType as ImportantItemSourceType,
      sourceId: row.sourceId,
      title: row.title,
      summary: row.summary,
      occurredAt: row.occurredAt.toISOString(),
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      senderOrOrganizer: row.senderOrOrganizer,
      category: row.category,
      importanceSignals: row.importanceSignalsJson,
      requiresAction: Boolean(row.requiresAction),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async syncConnectionSource(userId: string, input: { connectionId: string; sourceType: 'email' | 'calendar'; input?: Record<string, unknown> }) {
    try {
      const capability = input.sourceType === 'email' ? 'READ_EMAIL' : 'READ_EVENT';
      const result = await this.connections.invoke(userId, input.connectionId, {
        capability,
        requestId: `daily-summary-sync:${input.sourceType}:${Date.now()}`,
        input: input.input ?? {},
      });
      if (input.sourceType === 'email') {
        return Promise.all(((result.data.messages as Array<Record<string, unknown>> | undefined) ?? []).map((item) => this.createCandidate(userId, {
          sourceType: 'email',
          sourceId: String(item.messageId),
          title: String(item.subject ?? '未命名邮件'),
          summary: String(item.plainText ?? '邮件内容已同步'),
          occurredAt: String(item.occurredAt),
          senderOrOrganizer: typeof item.from === 'string' ? item.from : undefined,
          category: '邮件',
          importanceSignals: {
            highPriority: Array.isArray(item.labels) && item.labels.includes('IMPORTANT'),
            needsReply: String(item.subject ?? '').includes('请') || String(item.plainText ?? '').includes('请'),
          },
          requiresAction: String(item.subject ?? '').includes('确认') || String(item.plainText ?? '').includes('确认'),
        }))).then((items) => items.filter((item): item is NonNullable<typeof item> => Boolean(item)));
      }
      return Promise.all(((result.data.events as Array<Record<string, unknown>> | undefined) ?? []).map((item) => this.createCandidate(userId, {
        sourceType: 'calendar',
        sourceId: String(item.id),
        title: String(item.title ?? '未命名日程'),
        summary: [item.location, item.attendeesSummary].filter((part): part is string => typeof part === 'string' && part.length > 0).join(' · ') || '日历事件已同步',
        occurredAt: String(item.startAt),
        dueAt: typeof item.endAt === 'string' ? item.endAt : undefined,
        senderOrOrganizer: typeof item.organizer === 'string' ? item.organizer : undefined,
        category: '日历',
        importanceSignals: {
          markedImportant: String(item.title ?? '').includes('会议') || String(item.title ?? '').includes('考试'),
        },
        requiresAction: String(item.title ?? '').includes('会议') || String(item.title ?? '').includes('考试'),
      }))).then((items) => items.filter((item): item is NonNullable<typeof item> => Boolean(item)));
    } catch (error) {
      const message = error instanceof Error ? error.message : `${input.sourceType} source unavailable`;
      return [{
        sourceType: input.sourceType,
        sourceId: `connection-issue:${input.connectionId}`,
        title: input.sourceType === 'email' ? '邮件需要重新连接' : '日历需要重新连接',
        summary: message,
        occurredAt: new Date().toISOString(),
        dueAt: null,
        senderOrOrganizer: null,
        category: '连接',
        importanceSignals: { highPriority: true },
        requiresAction: true,
      }];
    }
  }
}
