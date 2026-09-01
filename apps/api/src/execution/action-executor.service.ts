import { Injectable } from '@nestjs/common';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { ACTION_DEFINITIONS, type NormalizedAction, type RiskLevel } from '@lazy-armor/plan-schema';
import { BillingService } from '../billing/billing.service';
import { ContentService } from '../content/content.service';
import { DailySummaryService } from '../daily-summary/daily-summary.service';
import { HouseholdService } from '../household/household.service';
import { LogisticsService } from '../logistics/logistics.service';
import { NotificationService } from '../notifications/notification.service';
import { ExecutionRuntimeError, asRuntimeError } from './execution.types';
import { RuntimeConnectionGuard } from './runtime-connection-guard.service';

@Injectable()
export class ActionExecutor {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly guard: RuntimeConnectionGuard,
    private readonly notifications: NotificationService,
    private readonly billing: BillingService,
    private readonly content: ContentService,
    private readonly dailySummary: DailySummaryService,
    private readonly logistics: LogisticsService,
    private readonly household: HouseholdService,
  ) {}

  supports(actionType: string): boolean { return ['record', 'compare', 'update_internal_record', 'classify', 'summarize', 'notify', 'prepare_purchase', 'generate_content', 'create_draft', 'prepare_publish'].includes(actionType); }

  async execute(userId: string, executionId: string, action: NormalizedAction, context: Record<string, unknown>, effectiveRisk: RiskLevel = action.riskLevel): Promise<Record<string, unknown>> {
    // 批准后的每一次执行都必须先重新过 Runtime Connection Guard（连接归属/状态/权限/能力/凭据），
    // Approval 永远不能覆盖 Permission Guard；随后才是 P0-7 Safety Gate。
    const checked = action.requiredCapability ? await this.assertConnectorInput(userId, action) : null;
    if (ACTION_DEFINITIONS[action.actionType].externalEffect || ['R3', 'R4'].includes(effectiveRisk)) {
      throw new ExecutionRuntimeError('SAFETY_GATE_REQUIRES_APPROVAL_AND_IDEMPOTENCY', 'This action requires P0-6 approval and P0-7 idempotency safeguards');
    }
    const local = this.enrichLocalContext(context);
    if (action.actionType === 'classify' && !action.connectionId) {
      const enriched = this.billing.enrichContext(local);
      return {
        billingSummary: {
          totalAmount: enriched.amount ?? 0,
          categoryTotals: enriched.categoryTotals ?? {},
          providerTotals: enriched.providerTotals ?? {},
          billingPeriod: enriched.billingPeriod ?? null,
        },
      };
    }
    if (action.actionType === 'record' && !action.connectionId) {
      return { recorded: true, recordType: action.config.recordType ?? 'execution_record' };
    }
    if (action.actionType === 'compare' && !action.connectionId) {
      const enriched = this.billing.enrichContext(local);
      const previous = typeof enriched.previousPeriodTotal === 'number' ? enriched.previousPeriodTotal : 0;
      const current = typeof enriched.currentPeriodTotal === 'number' ? enriched.currentPeriodTotal : typeof enriched.amount === 'number' ? enriched.amount : 0;
      const percentChange = previous === 0 ? null : Number((((current - previous) / previous) * 100).toFixed(2));
      const threshold = typeof action.config.anomalyThresholdPercent === 'number' ? action.config.anomalyThresholdPercent : null;
      return {
        compared: true,
        baseline: action.config.baseline ?? null,
        currentPeriodTotal: current,
        previousPeriodTotal: previous,
        amountChange: { previous, current },
        monthOverMonthChangePercent: percentChange,
        abnormal: threshold === null || percentChange === null ? current > previous : Math.abs(percentChange) > threshold,
      };
    }
    if (action.actionType === 'generate_content' && !action.connectionId) {
      const enriched = this.content.enrichContext(local);
      const generatedVariants = this.content.generatePlatformVariants(enriched, action.config);
      const invalid = generatedVariants.filter((variant) => !variant.validationResult.valid);
      return {
        generatedVariants,
        generatedVariantCount: generatedVariants.length,
        invalidVariantCount: invalid.length,
        targetPlatforms: generatedVariants.map((variant) => variant.platform),
        humanSummary: `已生成 ${generatedVariants.length} 个平台版本。`,
        resultSummary: invalid.length > 0
          ? `已生成 ${generatedVariants.length} 个平台版本。${invalid[0]?.validationResult.issues[0] ?? ''}`.trim()
          : `已生成 ${generatedVariants.length} 个平台版本。`,
      };
    }
    if (action.actionType === 'create_draft' && !action.connectionId) {
      const masterContentId = typeof local.masterContentId === 'string' ? local.masterContentId : null;
      const generatedVariants = this.normalizeGeneratedVariants(local.generatedVariants);
      if (!masterContentId || generatedVariants.length === 0) throw new ExecutionRuntimeError('INVALID_INPUT', 'Platform draft requires master content and generated variants');
      const saved = await this.content.createDraftVariants(userId, masterContentId, generatedVariants);
      return {
        platformVariants: saved,
        platformVariantIds: saved.map((variant) => variant.id),
        latestVariantCount: saved.length,
        humanSummary: `已生成 ${saved.length} 个平台版本。`,
        resultSummary: `已生成 ${saved.length} 个平台版本。`,
      };
    }
    if (action.actionType === 'prepare_publish' && !action.connectionId) {
      const variantIds = Array.isArray(local.platformVariantIds)
        ? local.platformVariantIds.filter((item): item is string => typeof item === 'string')
        : [];
      const prepared = await this.content.prepareVariants(userId, variantIds);
      const preparedReady = prepared.filter((variant) => variant.publishStatus === 'prepared');
      const needsRevision = prepared.filter((variant) => variant.publishStatus !== 'prepared');
      const preparedLabels = preparedReady.map((variant) => this.content.platformLabel(variant.platform));
      const invalidMessage = this.firstValidationIssue(needsRevision);
      const notificationPreference = typeof action.config.notificationPreference === 'string' ? action.config.notificationPreference : 'summary';
      const shouldNotify = needsRevision.length > 0 || notificationPreference !== 'silent';
      const successSummary = preparedLabels.length > 0
        ? `已为${preparedLabels.join('和')}准备好发布版本。`
        : '已生成平台版本，等待你继续处理。';
      return {
        preparedVariants: prepared,
        preparedVariantsCount: preparedReady.length,
        invalidVariantsCount: needsRevision.length,
        providerGate: typeof action.config.providerGate === 'string' ? action.config.providerGate : 'DRAFT_ONLY',
        waitingConfirmation: Boolean(action.config.requireApprovalBeforePublish),
        currentStrategy: Boolean(action.config.requireApprovalBeforePublish) ? '准备完成，仍需你确认后才能进入真实发布。' : '当前只停在草稿准备态，不会自动发布。',
        humanSummary: invalidMessage ?? successSummary,
        resultSummary: invalidMessage ?? successSummary,
        shouldNotify,
        notificationPriority: needsRevision.length > 0 || notificationPreference === 'important' ? 'P1' : 'P2',
        notificationEventType: needsRevision.length > 0 ? 'content_variant_revision_needed' : 'content_publish_prepared',
        notificationDedupeKey: `content-prepare:${typeof local.masterContentId === 'string' ? local.masterContentId : executionId}:${prepared.map((variant) => `${variant.platform}:${variant.publishStatus}`).join('|')}`,
      };
    }
    if (action.actionType === 'summarize' && !action.connectionId) {
      const billing = this.billing.enrichContext(local);
      const content = this.content.enrichContext(local);
      const summaryItems = this.dailySummary.enrichContext(local);
      const logistics = this.logistics.enrichContext(local, action.config);
      const household = this.household.enrichContext(local);
      if (action.config.domain === 'daily_summary') {
        const summary = this.dailySummary.summarize(summaryItems, action.config);
        const importantCount = summary.mustHandleCount + summary.shouldHandleCount;
        const notificationPreference = typeof action.config.notificationPreference === 'string' ? action.config.notificationPreference : 'summary';
        const humanSummary = importantCount === 0
          ? '今天没有需要处理的重要事项。'
          : `今天有 ${importantCount} 件重要事项，其中 ${summary.mustHandleCount} 件需要尽快处理。`;
        return {
          ...summary,
          humanSummary,
          resultSummary: humanSummary,
          shouldNotify: importantCount > 0 && notificationPreference !== 'silent',
          notificationPriority: summary.mustHandleCount > 0 || notificationPreference === 'important' ? 'P1' : 'P2',
          notificationEventType: 'daily_important_summary',
          notificationDedupeKey: `daily-summary:${summary.generatedAt.slice(0, 10)}`,
        };
      }
      if (action.config.domain === 'content') {
        const generatedVariants = this.normalizeGeneratedVariants(content.generatedVariants);
        const invalid = generatedVariants.filter((variant) => !variant.validationResult.valid);
        return {
          humanSummary: `已生成 ${generatedVariants.length} 个平台版本。`,
          resultSummary: invalid.length > 0
            ? invalid[0]?.validationResult.issues[0] ?? `已生成 ${generatedVariants.length} 个平台版本。`
            : `已生成 ${generatedVariants.length} 个平台版本。`,
          generatedVariantCount: generatedVariants.length,
          invalidVariantCount: invalid.length,
        };
      }
      if (action.config.domain === 'logistics') {
        const status = typeof logistics.currentStatus === 'string' ? logistics.currentStatus : 'unknown';
        const trackingMasked = typeof logistics.trackingNumberMasked === 'string' ? logistics.trackingNumberMasked : '这个快递';
        const latestEventSummary = typeof logistics.latestEventSummary === 'string' ? logistics.latestEventSummary : '暂无新进展';
        const staleHours = typeof logistics.staleHours === 'number' ? logistics.staleHours : null;
        const hoursSinceUpdate = typeof logistics.hoursSinceUpdate === 'number' ? logistics.hoursSinceUpdate : 0;
        const explicitException = Boolean(logistics.explicitException);
        const delivered = Boolean(logistics.delivered);
        const stale = Boolean(logistics.stale);
        const notifyOnDelivered = Boolean(action.config.notifyOnDelivered);
        const notifyOnException = action.config.notifyOnException !== false;
        const shouldNotify = stale || (explicitException && notifyOnException) || (delivered && notifyOnDelivered);
        const dedupeStatus = explicitException ? 'exception' : delivered ? 'delivered' : stale ? 'stale' : status;
        const humanSummary = explicitException
          ? shouldNotify
            ? '快递出现异常，已提醒你。'
            : '快递出现异常。'
          : stale && staleHours !== null
            ? `这个快递已经超过 ${staleHours} 小时没有新进展。`
            : delivered
              ? '快递已经签收。'
              : '检查快递：运输正常。';
        const resultSummary = explicitException
          ? shouldNotify
            ? `快递状态异常：${latestEventSummary}，已提醒你。`
            : `快递状态异常：${latestEventSummary}`
          : stale && staleHours !== null
            ? `这个快递已经 ${Math.round(hoursSinceUpdate)} 小时没有新进展，已提醒你。`
            : delivered
              ? '快递已经签收。'
              : '检查快递：运输正常。';
        return {
          humanSummary,
          resultSummary,
          trackingNumberMasked: trackingMasked,
          carrier: logistics.carrier ?? null,
          currentStatus: status,
          latestEventSummary,
          staleHours,
          isException: explicitException || stale,
          delivered,
          shouldNotify,
          notificationPriority: explicitException || stale ? 'P1' : 'P2',
          notificationEventType: explicitException ? 'logistics_exception' : delivered ? 'logistics_delivered' : 'logistics_stale',
          notificationDedupeKey: `logistics:${trackingMasked}:${dedupeStatus}:${latestEventSummary}`,
        };
      }
      if (action.config.domain === 'household') {
        const itemName = typeof household.itemName === 'string' ? household.itemName : '该用品';
        const daysUntilRunOut = typeof household.daysUntilRunOut === 'number' ? household.daysUntilRunOut : 0;
        const estimatedRunOutAt = typeof household.estimatedRunOutAt === 'string' ? household.estimatedRunOutAt : null;
        const preparationMode = typeof household.preparationMode === 'string' ? household.preparationMode : 'reminder';
        const nearRunOut = Boolean(household.nearRunOut);
        const humanSummary = nearRunOut
          ? preparationMode === 'shopping_list'
            ? `${itemName}预计 ${Math.max(daysUntilRunOut, 0)} 天后用完，已经帮你加入补货清单。`
            : `${itemName}预计 ${Math.max(daysUntilRunOut, 0)} 天后用完。`
          : `${itemName}预计还有 ${Math.max(daysUntilRunOut, 0)} 天。`;
        const resultSummary = nearRunOut
          ? preparationMode === 'shopping_list'
            ? `${itemName}预计 ${Math.max(daysUntilRunOut, 0)} 天后用完，已加入补货清单。`
            : `${itemName}预计 ${Math.max(daysUntilRunOut, 0)} 天后用完，已提醒你。`
          : `${itemName}预计还有 ${Math.max(daysUntilRunOut, 0)} 天。`;
        return {
          humanSummary,
          resultSummary,
          itemName,
          category: household.category ?? null,
          estimatedRunOutAt,
          daysUntilRunOut,
          nearRunOut,
          preparationMode,
          shouldNotify: nearRunOut,
          notificationPriority: 'P1',
          notificationEventType: 'household_supply_reminder',
          notificationDedupeKey: `household:${itemName}:${estimatedRunOutAt ?? daysUntilRunOut}:reminder`,
        };
      }
      const enriched = billing;
      const total = typeof enriched.currentPeriodTotal === 'number' ? enriched.currentPeriodTotal : typeof enriched.amount === 'number' ? enriched.amount : 0;
      const previous = typeof enriched.previousPeriodTotal === 'number' ? enriched.previousPeriodTotal : 0;
      const percentChange = typeof enriched.monthOverMonthChangePercent === 'number' ? enriched.monthOverMonthChangePercent : null;
      const categories = (enriched.categoryTotals ?? {}) as Record<string, number>;
      const categorySummary = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, amount]) => `${name}${amount.toFixed(2)}元`);
      if (action.config.guardType === 'mobile_bill') {
        return {
          humanSummary: `本月话费 ${total.toFixed(2)} 元${percentChange === null ? '' : `，较上月变化 ${percentChange.toFixed(2)}%`}。`,
          resultSummary: `本月话费 ${total.toFixed(2)} 元${percentChange === null ? '' : `，较上月 ${percentChange >= 0 ? '上涨' : '下降'} ${Math.abs(percentChange).toFixed(2)}%`}`,
        };
      }
      return {
        humanSummary: `本月总金额 ${total.toFixed(2)} 元${previous ? `，较上期变化 ${percentChange?.toFixed(2) ?? '0.00'}%` : ''}${categorySummary.length ? `，主要分类：${categorySummary.join('、')}` : ''}`,
        resultSummary: `月度账单已汇总：总金额 ${total.toFixed(2)} 元${previous ? `，上期 ${previous.toFixed(2)} 元` : ''}`,
        anomalyCategories: Object.entries(categories).filter(([, amount]) => amount > total * 0.4).map(([name]) => name),
      };
    }
    if (action.actionType === 'prepare_purchase' && !action.connectionId) {
      const enriched = this.household.enrichContext(local);
      const itemName = typeof enriched.itemName === 'string' ? enriched.itemName : typeof action.config.itemName === 'string' ? action.config.itemName : '用品';
      const quantitySuggestion = typeof enriched.purchaseQuantity === 'number' ? enriched.purchaseQuantity : 1;
      const reason = typeof enriched.resultSummary === 'string'
        ? enriched.resultSummary
        : `${itemName}预计很快用完，需要准备补货。`;
      const planId = typeof enriched.planId === 'string' ? enriched.planId : null;
      const estimatedRunOutAt = typeof enriched.estimatedRunOutAt === 'string' ? enriched.estimatedRunOutAt : 'unknown';
      const dedupeKey = `shopping-list:${itemName}:${estimatedRunOutAt}`;
      const prepared = planId ? await this.household.prepareShoppingItem(userId, planId, {
        itemName,
        quantitySuggestion,
        reason,
        dedupeKey,
      }) : null;
      return {
        preparedShoppingItem: prepared,
        shoppingListPrepared: true,
        humanSummary: `${itemName}预计 ${Math.max(typeof enriched.daysUntilRunOut === 'number' ? enriched.daysUntilRunOut : 0, 0)} 天后用完，已经帮你加入补货清单。`,
        resultSummary: `${itemName}预计 ${Math.max(typeof enriched.daysUntilRunOut === 'number' ? enriched.daysUntilRunOut : 0, 0)} 天后用完，已加入补货清单。`,
        itemName,
        quantitySuggestion,
      };
    }
    if (action.actionType === 'notify' && !action.connectionId) {
      if (context.shouldNotify === false) return { notified: false, skipped: true };
      const title = typeof context.humanSummary === 'string' ? context.humanSummary.slice(0, 60) : '计划有新的结果';
      const body = typeof context.resultSummary === 'string' ? context.resultSummary : title;
      const priority = action.config.priority === 'P1' || action.config.priority === 'P0' || action.config.priority === 'P2' || action.config.priority === 'P3'
        ? action.config.priority
        : context.notificationPriority === 'P1' || context.notificationPriority === 'P0' || context.notificationPriority === 'P2' || context.notificationPriority === 'P3'
          ? context.notificationPriority
        : 'P2';
      await this.notifications.emit({
        userId,
        executionId,
        priority,
        eventType: typeof context.notificationEventType === 'string'
          ? context.notificationEventType
          : typeof action.config.eventType === 'string'
            ? action.config.eventType
            : 'plan_notification',
        dedupeKey: typeof context.notificationDedupeKey === 'string' ? context.notificationDedupeKey : `execution:${executionId}:step:${action.stepOrder}`,
        title,
        body,
      });
      return { notified: true, priority, title, body };
    }
    if (action.actionType !== 'record' && action.actionType !== 'update_internal_record') {
      throw new ExecutionRuntimeError('ACTION_RUNTIME_NOT_IMPLEMENTED', `Action runtime is not implemented: ${action.actionType}`);
    }
    if (!checked) throw new ExecutionRuntimeError('INVALID_INPUT', 'Connector action requires connectionId and requiredCapability');
    let connector;
    try { connector = this.registry.get(checked.connectorKey); } catch { throw new ExecutionRuntimeError('CONNECTOR_NOT_FOUND', 'Connector runtime is unavailable'); }
    try {
      const request = { capability: action.requiredCapability!, input: { context, config: action.config }, requestId: `${executionId}:${action.stepOrder}` };
      const result = checked.operation === 'read' && connector.read ? await connector.read(request)
        : checked.operation === 'execute' && connector.execute ? await connector.execute(request)
          : checked.operation === 'subscribe' && connector.subscribe ? await connector.subscribe(request)
            : null;
      if (!result) throw new ExecutionRuntimeError('ACTION_RUNTIME_NOT_IMPLEMENTED', 'Connector does not implement the required operation');
      if (!result.ok) throw new ExecutionRuntimeError('CONNECTOR_TEMPORARY_ERROR', 'Connector returned a temporary failure', true);
      return result.data;
    } catch (error) {
      const mapped = asRuntimeError(error);
      if (mapped.code !== 'INTERNAL_EXECUTION_ERROR') throw mapped;
      throw new ExecutionRuntimeError('CONNECTOR_TEMPORARY_ERROR', mapped.message, true);
    }
  }

  private async assertConnectorInput(userId: string, action: NormalizedAction) {
    if (!action.connectionId || !action.requiredCapability) throw new ExecutionRuntimeError('INVALID_INPUT', 'Connector action requires connectionId and requiredCapability');
    return this.guard.assertUsable(userId, action.connectionId, action.requiredCapability);
  }

  private enrichLocalContext(context: Record<string, unknown>) {
    return this.dailySummary.enrichContext(this.household.enrichContext(this.logistics.enrichContext(this.content.enrichContext(this.billing.enrichContext(context)))));
  }

  private normalizeGeneratedVariants(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      const tags = Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [];
      const validation = row.validationResult && typeof row.validationResult === 'object' && !Array.isArray(row.validationResult)
        ? row.validationResult as { valid?: unknown; issues?: unknown; titleLength?: unknown; descriptionLength?: unknown; tagCount?: unknown }
        : null;
      if (typeof row.platform !== 'string' || typeof row.title !== 'string' || typeof row.description !== 'string' || typeof row.coverRequirements !== 'string' || typeof row.publishStatus !== 'string' || !validation) return [];
      return [{
        platform: row.platform,
        title: row.title,
        description: row.description,
        tags,
        coverRequirements: row.coverRequirements,
        publishStatus: row.publishStatus,
        validationResult: {
          valid: Boolean(validation.valid),
          issues: Array.isArray(validation.issues) ? validation.issues.filter((issue): issue is string => typeof issue === 'string') : [],
          titleLength: typeof validation.titleLength === 'number' ? validation.titleLength : row.title.length,
          descriptionLength: typeof validation.descriptionLength === 'number' ? validation.descriptionLength : row.description.length,
          tagCount: typeof validation.tagCount === 'number' ? validation.tagCount : tags.length,
        },
      }];
    });
  }

  private firstValidationIssue(variants: Array<{ validationResult: unknown }>) {
    for (const variant of variants) {
      const validation = variant.validationResult;
      if (!validation || typeof validation !== 'object' || Array.isArray(validation)) continue;
      const issues = (validation as { issues?: unknown }).issues;
      if (!Array.isArray(issues)) continue;
      const first = issues.find((issue): issue is string => typeof issue === 'string');
      if (first) return first;
    }
    return null;
  }
}
