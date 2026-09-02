import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { webhookReceipts } from '@lazy-armor/database';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class WebhookRetentionService implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(WebhookRetentionService.name);
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly config: ConfigService, private readonly audit: AuditService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const interval = (this.config.get<number>('WEBHOOK_CLEANUP_INTERVAL_SECONDS') ?? 3600) * 1000;
    void this.cleanup().catch((error) => {
      this.logger.warn(`Webhook startup cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    });
    this.timer = setInterval(() => void this.cleanup().catch((error) => {
      this.logger.warn(`Webhook retention cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }), interval);
    this.timer.unref();
  }

  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }

  async cleanup(now = new Date(), batchSize = 500) {
    const due = await this.db.select({ id: webhookReceipts.id }).from(webhookReceipts)
      .where(and(lte(webhookReceipts.expiresAt, now), isNull(webhookReceipts.purgedAt))).limit(Math.min(Math.max(batchSize, 1), 1000));
    for (const row of due) {
      await this.db.update(webhookReceipts).set({ payload: '{}', purgedAt: now }).where(and(eq(webhookReceipts.id, row.id), isNull(webhookReceipts.purgedAt)));
    }
    if (due.length) await this.audit.append({ actorType: 'system', actorUserId: null, action: 'WEBHOOK_PAYLOAD_RETENTION_CLEANUP', resourceType: 'webhook_receipt', resourceId: null, userId: null, source: 'system', result: 'success', changeSummary: `Purged raw payload storage for ${due.length} expired webhook receipts`, after: { purged: due.length } });
    return { purged: due.length };
  }
}
