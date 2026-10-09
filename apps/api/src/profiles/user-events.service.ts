import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { notifications, recurringItemProfiles } from '@lazy-armor/database';
import { userEventInputSchema, type UserEventInput, type UserEventView } from '@lazy-armor/plan-schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';

type Row = typeof recurringItemProfiles.$inferSelect;
type Tx = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];
interface EventMetadata { schema: 'user-event.v1'; version: number; timezone: string; dueAt: string; reminderAtEpochMs: number; reminderAt: string; remindedAt: string | null; conversationId: string; proposalMessageId: string }
function metadata(row: Row): EventMetadata {
  const m = row.metadataJson as unknown as EventMetadata;
  if (row.sourceType !== 'user_event' || m?.schema !== 'user-event.v1' || !Number.isInteger(m.version)) throw new ConflictException('USER_EVENT_CONTRACT_INVALID');
  return { ...m };
}
export function projectUserEvent(row: Row): UserEventView {
  const m = metadata(row);
  return { id: row.id, kind: 'USER_EVENT', title: row.title, dueAt: m.dueAt, reminderAt: m.reminderAt, timezone: m.timezone, status: row.status as UserEventView['status'], version: m.version, remindedAt: m.remindedAt, completedAt: row.lastCompletedAt?.toISOString() ?? null };
}

/** One-time contract on the existing personal-item authority, never a Plan scheduler. */
@Injectable()
export class UserEventsService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService, private readonly reminders: NotificationService) {}

  parse(input: unknown, future = true): UserEventInput {
    const parsed = userEventInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException({ code: 'USER_EVENT_INVALID', errors: parsed.error.issues });
    if (future && Date.parse(parsed.data.reminderAt) <= Date.now()) throw new BadRequestException('提醒时间必须在未来，请重新确认时间');
    return parsed.data;
  }
  async createConfirmed(tx: Tx, userId: string, messageId: string, conversationId: string, input: unknown) {
    const existing = (await tx.select().from(recurringItemProfiles).where(eq(recurringItemProfiles.id, messageId)).for('update'))[0];
    if (existing) {
      if (existing.userId !== userId || metadata(existing).conversationId !== conversationId) throw new ConflictException('USER_EVENT_CONFIRMATION_CONFLICT');
      return projectUserEvent(existing);
    }
    const value = this.parse(input);
    const now = new Date();
    const m: EventMetadata = { schema: 'user-event.v1', version: 1, timezone: value.timezone, dueAt: value.dueAt, reminderAtEpochMs: Date.parse(value.reminderAt), reminderAt: value.reminderAt, remindedAt: null, conversationId, proposalMessageId: messageId };
    await tx.insert(recurringItemProfiles).values({ id: messageId, userId, domain: 'personal', category: 'USER_EVENT', title: value.title, nextDueAt: new Date(value.dueAt), recurrenceDays: null, remindBeforeDays: 0, status: 'active', sourceType: 'user_event', metadataJson: { ...m }, createdAt: now, updatedAt: now });
    await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'USER_EVENT_CREATED', resourceType: 'user_event', resourceId: messageId, correlationId: conversationId, source: 'api', result: 'success', changeSummary: 'Confirmed one-time internal reminder', after: { ...value, version: 1, proposalMessageId: messageId } }, tx);
    return projectUserEvent((await tx.select().from(recurringItemProfiles).where(eq(recurringItemProfiles.id, messageId)))[0]);
  }
  async get(userId: string, id: string, executor: Pick<InjectedDatabase, 'select'> = this.db) {
    const row = (await executor.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.id, id), eq(recurringItemProfiles.userId, userId), eq(recurringItemProfiles.sourceType, 'user_event'))))[0];
    if (!row) throw new NotFoundException('事项不存在');
    return projectUserEvent(row);
  }
  async list(userId: string) {
    return (await this.db.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.userId, userId), eq(recurringItemProfiles.sourceType, 'user_event'))).orderBy(desc(recurringItemProfiles.nextDueAt))).map(projectUserEvent);
  }
  async change(userId: string, id: string, input: { version: number; action: 'EDIT' | 'POSTPONE' | 'COMPLETE' | 'CANCEL'; event?: unknown }) {
    await this.db.transaction(async tx => {
      const row = (await tx.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.id, id), eq(recurringItemProfiles.userId, userId), eq(recurringItemProfiles.sourceType, 'user_event'))).for('update'))[0];
      if (!row) throw new NotFoundException('事项不存在');
      const m = metadata(row);
      if (m.version !== input.version) throw new ConflictException('事项已更新，请刷新');
      if (row.status !== 'active') throw new ConflictException('已结束的事项不能继续修改');
      const now = new Date();
      const patch: Partial<typeof recurringItemProfiles.$inferInsert> = { updatedAt: now };
      if (input.action === 'EDIT' || input.action === 'POSTPONE') {
        const value = this.parse(input.event);
        if (input.action === 'POSTPONE' && (Date.parse(value.reminderAt) <= Date.parse(m.reminderAt) || value.title !== row.title)) throw new BadRequestException('延后仅可移动到更晚的时间');
        patch.title = value.title; patch.nextDueAt = new Date(value.dueAt);
        m.timezone = value.timezone; m.dueAt = value.dueAt; m.reminderAtEpochMs = Date.parse(value.reminderAt); m.reminderAt = value.reminderAt; m.remindedAt = null;
      } else if (input.action === 'COMPLETE') { patch.status = 'completed'; patch.lastCompletedAt = now; }
      else if (input.action === 'CANCEL') patch.status = 'cancelled';
      else throw new BadRequestException('Unknown USER_EVENT action');
      await tx.update(notifications).set({ status: 'archived', archivedAt: now, updatedAt: now }).where(and(eq(notifications.userId, userId), eq(notifications.dedupeKey, `user-event:${id}:${m.version}`)));
      m.version += 1; patch.metadataJson = { ...m };
      await tx.update(recurringItemProfiles).set(patch).where(eq(recurringItemProfiles.id, id));
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: `USER_EVENT_${input.action}`, resourceType: 'user_event', resourceId: id, correlationId: id, source: 'api', result: 'success', changeSummary: 'Internal personal item lifecycle updated', before: projectUserEvent(row), after: { ...patch, metadataJson: m } }, tx);
    });
    return this.get(userId, id);
  }
  async deliverDue() {
    // Existing Outbox Worker wakes this authority; no second timer or Plan engine.
    return this.db.transaction(async tx => {
      const rows = await tx.select().from(recurringItemProfiles).where(and(eq(recurringItemProfiles.sourceType, 'user_event'), eq(recurringItemProfiles.status, 'active'), sql`JSON_EXTRACT(${recurringItemProfiles.metadataJson}, '$.remindedAt') = CAST('null' AS JSON)`, sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${recurringItemProfiles.metadataJson}, '$.reminderAtEpochMs')) AS UNSIGNED) <= ${Date.now()}`)).orderBy(recurringItemProfiles.nextDueAt).limit(100).for('update', { skipLocked: true });
      let delivered = 0;
      for (const row of rows) {
        const m = metadata(row);
        if (Date.parse(m.reminderAt) > Date.now()) continue;
        this.parse(projectInput(row), false);
        const notification = await this.reminders.emit({ userId: row.userId, eventType: 'user_event_due', priority: 'P2', actionRequired: true, dedupeKey: `user-event:${row.id}:${m.version}`, title: row.title, body: '提醒时间到了。你可以完成、延后或取消这件事。', actionType: 'USER_EVENT', messageParams: { userEventId: row.id, version: m.version } }, tx);
        if (!notification) throw new ConflictException('USER_EVENT_REMINDER_NOT_COMMITTED');
        m.remindedAt = new Date().toISOString();
        await tx.update(recurringItemProfiles).set({ metadataJson: { ...m }, updatedAt: new Date() }).where(eq(recurringItemProfiles.id, row.id));
        delivered += 1;
      }
      return delivered;
    });
  }
}
function projectInput(row: Row): UserEventInput { const m = metadata(row); return { title: row.title, dueAt: m.dueAt, reminderAt: m.reminderAt, timezone: m.timezone }; }
