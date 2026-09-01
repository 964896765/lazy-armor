import { Injectable } from '@nestjs/common';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import type { NormalizedSource } from '@lazy-armor/plan-schema';
import { BillingService } from '../billing/billing.service';
import { ContentService } from '../content/content.service';
import { DailySummaryService } from '../daily-summary/daily-summary.service';
import { HouseholdService } from '../household/household.service';
import { LogisticsService } from '../logistics/logistics.service';
import { ExecutionRuntimeError } from './execution.types';
import { RuntimeConnectionGuard } from './runtime-connection-guard.service';

@Injectable()
export class SourceResolver {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly guard: RuntimeConnectionGuard,
    private readonly billing: BillingService,
    private readonly content: ContentService,
    private readonly dailySummary: DailySummaryService,
    private readonly logistics: LogisticsService,
    private readonly household: HouseholdService,
  ) {}

  async resolve(userId: string, sources: NormalizedSource[], triggerPayload: Record<string, unknown>, requestId: string): Promise<Record<string, unknown>> {
    let context = { ...triggerPayload };
    for (const source of sources) {
      if (source.sourceType === 'manual') {
        context = this.enrichLocalContext(context);
        continue;
      }
      if (source.sourceType !== 'internal') throw new ExecutionRuntimeError('SOURCE_RUNTIME_NOT_IMPLEMENTED', `Source runtime is not implemented: ${source.sourceType}`);
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
    return this.dailySummary.enrichContext(this.household.enrichContext(this.logistics.enrichContext(this.content.enrichContext(this.billing.enrichContext(context)))));
  }
}
