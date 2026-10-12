import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { personalMemories } from '@lazy-armor/database';
import { reportDecisionContent, reportDecisionInputSchema } from '@lazy-armor/plan-schema';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { MemoryService } from './memory.service';
import { readDecisionReport } from './report-decision-source';
import { decodeCursor, pageResult, type CursorPageDto } from '../common/cursor-pagination';

/** A user's report decision is confirmed personal input, never evidence of market/goal success. */
@Injectable()
export class ReportDecisionsService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly memories: MemoryService) {}
  async source(userId: string, conversationId: string, messageId: string) {
    const source = await readDecisionReport(this.db, userId, conversationId, messageId);
    if (!source) throw new NotFoundException('Report decision source unavailable');
    return { title: source.report.plan?.title ?? '报告', reportRevision: source.ref.reportRevision, reportHash: source.ref.reportHash,
      goalId: source.ref.goalId, goalVersion: source.ref.goalVersion };
  }
  async save(userId: string, raw: unknown) {
    const parsed = reportDecisionInputSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('REPORT_DECISION_INPUT_INVALID');
    const input = parsed.data;
    return this.db.transaction(async tx => {
      // Same publication lock order as Consumer: Conversation, Settings, referenced rows.
      const source = await readDecisionReport(tx, userId, input.conversationId, input.messageId, true);
      if (!source) throw new NotFoundException('Report decision source unavailable');
      if (source.ref.reportRevision !== input.reportRevision || source.ref.reportHash !== input.reportHash) throw new ConflictException('REPORT_DECISION_SOURCE_CHANGED');
      await this.memories.lockSettings(tx, userId);
      const memory = await this.memories.saveConfirmed(tx, userId, { type: 'DECISION', title: `我的决定：${input.decision}`.slice(0, 120),
        content: reportDecisionContent(input), confirmed: true, requestId: `report-decision:${input.requestId}` }, source.ref);
      return memory;
    });
  }
  async list(userId: string, conversationId: string, messageId: string, input: CursorPageDto) {
    const source = await readDecisionReport(this.db, userId, conversationId, messageId);
    if (!source) throw new NotFoundException('Report decision source unavailable');
    // Existing store contains all decisions; no new truth, execution or decision table.
    const cursor = decodeCursor(input.cursor);
    const rows = await this.db.select().from(personalMemories).where(and(eq(personalMemories.userId, userId), eq(personalMemories.status, 'ACTIVE'), eq(personalMemories.sourceKind, 'REPORT_DECISION_CONFIRMED'),
      sql`JSON_UNQUOTE(JSON_EXTRACT(${personalMemories.sourceRefJson}, '$.conversationId')) = ${conversationId}`,
      sql`JSON_UNQUOTE(JSON_EXTRACT(${personalMemories.sourceRefJson}, '$.messageId')) = ${messageId}`,
      cursor ? or(lt(personalMemories.createdAt, cursor.createdAt), and(eq(personalMemories.createdAt, cursor.createdAt), lt(personalMemories.id, cursor.id))) : undefined))
      .orderBy(desc(personalMemories.createdAt), desc(personalMemories.id)).limit(input.limit + 1);
    const page = pageResult(rows, input.limit);
    return { items: page.items.map(row => ({ id: row.id, version: row.version,
      title: row.title, content: row.content, reportRevision: row.sourceRefJson && 'kind' in row.sourceRefJson && row.sourceRefJson.kind === 'REPORT_DECISION' ? row.sourceRefJson.reportRevision : null,
      sourceCurrent: row.sourceRefJson && 'kind' in row.sourceRefJson && row.sourceRefJson.kind === 'REPORT_DECISION' &&
        row.sourceRefJson.reportHash === source.ref.reportHash && row.sourceRefJson.reportRevision === source.ref.reportRevision,
      confirmedAt: row.confirmedAt.toISOString() })), nextCursor: page.nextCursor };
  }
}
