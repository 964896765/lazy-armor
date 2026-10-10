import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import type { NormalizedSource } from '@lazy-armor/plan-schema';
import { BillingService } from '../billing/billing.service';
import { ContentService } from '../content/content.service';
import { DailySummaryService } from '../daily-summary/daily-summary.service';
import { DeviceService } from '../device/device.service';
import { HouseholdService } from '../household/household.service';
import { LogisticsService } from '../logistics/logistics.service';
import { StudyService } from '../study/study.service';
import { ConnectionsService } from '../connections/connections.service';
import { ProfilesService } from '../profiles/profiles.service';
import { OperationsService } from '../operations/operations.service';
import { TruthStoreService } from '../truth-store/truth-store.service';
import { asRuntimeError, ExecutionRuntimeError } from './execution.types';
import { RuntimeConnectionGuard } from './runtime-connection-guard.service';
import { WEB_READ } from '../connectors/public-web.connector';
import { githubDigestSchema, githubTrendingSchema } from '@lazy-armor/plan-schema';
import { executionSteps, executions } from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import type { ConsumerReadSource } from '../connections/consumer-read-source.service';

@Injectable()
export class SourceResolver {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly guard: RuntimeConnectionGuard,
    private readonly connections: ConnectionsService,
    private readonly billing: BillingService,
    private readonly content: ContentService,
    private readonly dailySummary: DailySummaryService,
    private readonly device: DeviceService,
    private readonly logistics: LogisticsService,
    private readonly household: HouseholdService,
    private readonly study: StudyService,
    private readonly profiles: ProfilesService,
    private readonly operations: OperationsService,
    private readonly truthStore: TruthStoreService,
    @Optional() @Inject(DATABASE) private readonly db?: InjectedDatabase,
  ) {}

  async resolve(userId: string, sources: NormalizedSource[], triggerPayload: Record<string, unknown>, requestId: string): Promise<Record<string, unknown>> {
    let context = { ...triggerPayload };
    for (const source of sources) {
      if (source.sourceType === 'file' && source.config.mode === 'github_trending_daily') {
        if (source.connectorKey !== 'public_web_research' || !source.connectionId || source.config.mode !== 'github_trending_daily') throw new ExecutionRuntimeError('GITHUB_SOURCE_INVALID', '固定 GitHub 日榜来源无效');
        if (!this.db) throw new ExecutionRuntimeError('GITHUB_SOURCE_INVALID', 'GitHub 来源保存不可用');
        // Resume only the already committed output of this owned execution. The
        // original Runner skips succeeded steps, so restore their fenced source.
        const saved = (await this.db.select({ output: executionSteps.outputSnapshotJson }).from(executions)
          .innerJoin(executionSteps, and(eq(executionSteps.executionId, executions.id), eq(executionSteps.actionType, 'summarize'), eq(executionSteps.status, 'succeeded')))
          .where(and(eq(executions.userId, userId), eq(executions.requestId, requestId))).limit(1))[0]?.output;
        if (saved?.githubDigest) {
          const digest = githubDigestSchema.parse(saved.githubDigest), authority = saved.githubReadAuthority as ConsumerReadSource | undefined;
          if (!authority || authority.userId !== userId || authority.connectionId !== source.connectionId || authority.capabilityKey !== WEB_READ) throw new ExecutionRuntimeError('GITHUB_SOURCE_INVALID', '已保存来源授权不匹配');
          await this.connections.assertConsumerReadAuthority(authority);
          context = { ...context, githubSource: { authority, data: digest.source }, githubDigest: digest };
          continue;
        }
        await this.connections.preparePublicWebRead(userId, source.connectionId);
        const authority = await this.connections.captureConsumerReadAuthority(userId, source.connectionId, WEB_READ);
        const result = await this.connections.invokeConsumerRead(userId, source.connectionId, { capability: WEB_READ, requestId: `${requestId}:source:${source.sortOrder}`, input: { mode: 'github_trending_daily' } });
        if (!result.ok) throw new ExecutionRuntimeError('GITHUB_READ_FAILED', 'GitHub 日榜读取失败', true);
        await this.connections.assertConsumerReadAuthority(authority);
        context = { ...context, githubSource: { authority, data: githubTrendingSchema.parse(result.data.githubTrending) }, githubDigest: null };
        continue;
      }
      if (source.sourceType === 'manual') {
        context = this.enrichLocalContext(context);
        continue;
      }
      if (source.sourceType !== 'internal') {
        const capability = sourceCapability(source.sourceType, source.config);
        if (!capability) throw new ExecutionRuntimeError('SOURCE_RUNTIME_NOT_IMPLEMENTED', `Source runtime is not implemented: ${source.sourceType}`);
        if (!source.connectionId) throw new ExecutionRuntimeError('SOURCE_CONNECTION_REQUIRED', `${source.sourceType} source requires a connection`);
        // Use the same invocation path as the public Connector API so current
        // permission, current credential version and provider availability are
        // checked again for every execution. No historical Plan grant is trusted.
        try {
          await this.guard.assertUsable(userId, source.connectionId, capability);
          const result = await this.connections.invoke(userId, source.connectionId, {
            capability,
            requestId: `${requestId}:source:${source.sortOrder}`,
            input: source.sourceType === 'file' ? { ...context, ...source.config } : source.config,
          });
          if (!result.ok) throw new ExecutionRuntimeError('CONNECTOR_TEMPORARY_ERROR', `${source.sourceType} source read failed`, true);
          context = { ...context, ...result.data };
        } catch (error) {
          const mapped = asRuntimeError(error);
          throw new ExecutionRuntimeError(mapped.code, `${source.sourceType}:${mapped.message}`, mapped.retryable);
        }
        continue;
      }
      if (!source.connectionId) {
        if (source.config.resource === 'billing_records') {
          context = await this.billing.resolveInternal(userId, source.config, context);
          continue;
        }
        if (source.config.resource === 'logistics_tracking_snapshots') {
          context = await this.logistics.resolveInternal(userId, source.config, context);
          continue;
        }
        if (source.config.resource === 'household_supply_profile') {
          context = this.household.resolveInternal(userId, source.config, context);
          continue;
        }
        if (source.config.resource === 'master_content') {
          context = await this.content.resolveInternal(userId, source.config, context);
          continue;
        }
        if (source.config.resource === 'important_item_candidates') {
          context = await this.dailySummary.resolveInternal(userId, source.config, context);
          continue;
        }
        if (source.config.resource === 'study_plan') {
          context = await this.study.resolveInternal(userId, source.config, context);
          continue;
        }
        if (source.config.resource === 'device_consumable') {
          context = await this.device.resolveInternal(userId, source.config, context);
          continue;
        }
        if (source.config.resource === 'vehicle_profile' || source.config.resource === 'digital_account_profile' || source.config.resource === 'recurring_item_profile') {
          context = await this.profiles.resolveInternal(userId, source.config, context);
          continue;
        }
        if (source.config.resource === 'operational_records') {
          context = await this.operations.resolveInternal(userId, source.config, context);
          continue;
        }
        if (source.config.resource === 'mobile.billing.transaction') {
          context = await this.truthStore.resolveMobileBillingTransactions(userId, context);
          continue;
        }
        if (source.config.resource === 'finance.transaction') {
          context = await this.truthStore.resolveFinanceTransactions(userId, context);
          continue;
        }
        throw new ExecutionRuntimeError('SOURCE_CONNECTION_REQUIRED', 'Internal source requires a connection');
      }
      const checked = await this.guard.assertUsable(userId, source.connectionId, 'READ_INTERNAL');
      const connector = this.registry.get(checked.connectorKey);
      if (!connector.read) throw new ExecutionRuntimeError('SOURCE_RUNTIME_NOT_IMPLEMENTED', 'Connector does not implement source read');
      const result = await connector.read({ capability: 'READ_INTERNAL', input: context, requestId });
      if (!result.ok) throw new ExecutionRuntimeError('CONNECTOR_TEMPORARY_ERROR', 'Internal source read failed', true);
      context = { ...context, ...result.data };
    }
    return this.enrichLocalContext(context);
  }

  private enrichLocalContext(context: Record<string, unknown>) {
    return this.study.enrichContext(this.device.enrichContext(this.dailySummary.enrichContext(this.household.enrichContext(this.logistics.enrichContext(this.content.enrichContext(this.billing.enrichContext(context)))))));
  }
}

function sourceCapability(sourceType: string, config: Record<string, unknown>) {
  switch (sourceType) {
    case 'email': return 'READ_EMAIL';
    case 'calendar': return 'READ_EVENT';
    case 'file': return config.metadataOnly === true ? 'READ_FILE_METADATA' : 'READ_FILE';
    case 'logistics': return 'READ_TRACKING';
    case 'content_platform': return 'READ_CONTENT';
    default: return null;
  }
}
