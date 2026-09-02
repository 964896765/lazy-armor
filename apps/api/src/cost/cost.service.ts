import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lt, sum } from 'drizzle-orm';
import { costBudgets, usageEvents } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { SECURITY_CAPABILITIES } from '../membership/entitlement-catalog';
import { UsageService } from '../usage/usage.service';

const PREMIUM_CAPABILITIES = new Set(['advanced_ai', 'premium_connector', 'advanced_summary', 'premium_template']);
const COST_ESTIMATES = {
  ai_input_1k: 2,
  ai_output_1k: 8,
  connector_operation: 1,
  storage_mb_month: 1,
  notification_delivery: 1,
} as const;

@Injectable()
export class CostService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
  ) {}

  estimate(input: { aiInputUnits?: number; aiOutputUnits?: number; connectorOperations?: number; storageBytes?: number; notificationDeliveries?: number }) {
    const ceil = (value: number, divisor: number) => Math.ceil(Math.max(0, value) / divisor);
    return ceil(input.aiInputUnits ?? 0, 1000) * COST_ESTIMATES.ai_input_1k
      + ceil(input.aiOutputUnits ?? 0, 1000) * COST_ESTIMATES.ai_output_1k
      + Math.max(0, input.connectorOperations ?? 0) * COST_ESTIMATES.connector_operation
      + ceil(input.storageBytes ?? 0, 1024 * 1024) * COST_ESTIMATES.storage_mb_month
      + Math.max(0, input.notificationDeliveries ?? 0) * COST_ESTIMATES.notification_delivery;
  }

  async charge(input: {
    userId: string;
    provider: string;
    capability: string;
    category: 'ai' | 'connector' | 'storage' | 'notification' | 'execution';
    resourceType: string;
    resourceId: string;
    identity: string;
    providerCostMinor: number;
  }) {
    if (!Number.isInteger(input.providerCostMinor) || input.providerCostMinor < 0) {
      throw new BadRequestException('Provider cost must be a non-negative integer');
    }
    const usageIdentity = 'provider_cost:' + input.identity;
    const existing = await this.db.select({ id: usageEvents.id }).from(usageEvents)
      .where(eq(usageEvents.usageIdentity, usageIdentity)).limit(1);
    if (existing[0]) return { created: false };
    const bypass = SECURITY_CAPABILITIES.has(input.capability);
    const guarded = PREMIUM_CAPABILITIES.has(input.capability) && !bypass;
    return this.db.transaction(async (tx) => {
      if (guarded) {
        const keys = ['user:' + input.userId, 'provider:' + input.provider].sort();
        const budgets = await tx.select().from(costBudgets)
          .where(and(inArray(costBudgets.budgetKey, keys), eq(costBudgets.status, 'active')))
          .orderBy(costBudgets.budgetKey)
          .for('update');
        const duplicate = await tx.select({ id: usageEvents.id }).from(usageEvents)
          .where(eq(usageEvents.usageIdentity, usageIdentity)).limit(1);
        if (duplicate[0]) return { created: false };
        const { start, end } = this.monthWindow();
        for (const budget of budgets) {
          const conditions = [gte(usageEvents.occurredAt, start), lt(usageEvents.occurredAt, end)];
          if (budget.scopeType === 'user' && budget.userId) conditions.push(eq(usageEvents.userId, budget.userId));
          if (budget.scopeType === 'provider' && budget.provider) conditions.push(eq(usageEvents.provider, budget.provider));
          const rows = await tx.select({ total: sum(usageEvents.providerCostMinor) }).from(usageEvents).where(and(...conditions));
          const spent = Number(rows[0]?.total ?? 0);
          if (spent + input.providerCostMinor > budget.monthlyLimitMinor) {
            throw new ForbiddenException({
              code: 'COST_BUDGET_EXCEEDED',
              message: '本月高级能力成本额度已用完，安全操作仍可继续使用。',
            });
          }
        }
      }
      return this.usage.record({
        userId: input.userId,
        usageType: 'provider_cost.' + input.category,
        quantity: 1,
        unit: 'operation',
        provider: input.provider,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        usageIdentity,
        billable: false,
        providerCostMinor: input.providerCostMinor,
      }, tx);
    });
  }

  async setBudget(actorUserId: string, input: {
    scopeType: 'user' | 'provider';
    userId?: string;
    provider?: string;
    monthlyLimitMinor: number;
    currency: string;
  }) {
    if (input.scopeType === 'user' && !input.userId) throw new BadRequestException('userId is required for a user budget');
    if (input.scopeType === 'provider' && !input.provider) throw new BadRequestException('provider is required for a provider budget');
    const budgetKey = input.scopeType === 'user' ? 'user:' + input.userId : 'provider:' + input.provider;
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(costBudgets).values({
        id: newId(), budgetKey, scopeType: input.scopeType,
        userId: input.scopeType === 'user' ? input.userId : null,
        provider: input.scopeType === 'provider' ? input.provider : null,
        monthlyLimitMinor: input.monthlyLimitMinor, currency: input.currency.toUpperCase(),
        status: 'active', createdAt: now, updatedAt: now,
      }).onDuplicateKeyUpdate({ set: {
        monthlyLimitMinor: input.monthlyLimitMinor,
        currency: input.currency.toUpperCase(), status: 'active', updatedAt: now,
      } });
      await this.audit.append({
        actorType: 'admin', actorUserId, action: 'COST_BUDGET_SET',
        resourceType: 'cost_budget', resourceId: budgetKey,
        userId: input.userId ?? actorUserId, source: 'api', result: 'success',
        after: { scopeType: input.scopeType, monthlyLimitMinor: input.monthlyLimitMinor, currency: input.currency.toUpperCase() },
        changeSummary: 'Monthly cost budget set for ' + budgetKey,
      }, tx);
    });
    return { budgetKey, ...input, currency: input.currency.toUpperCase(), status: 'active' };
  }

  async summary(userId: string) {
    const { start, end } = this.monthWindow();
    const rows = await this.db.select({ provider: usageEvents.provider, total: sum(usageEvents.providerCostMinor) })
      .from(usageEvents)
      .where(and(eq(usageEvents.userId, userId), gte(usageEvents.occurredAt, start), lt(usageEvents.occurredAt, end)))
      .groupBy(usageEvents.provider);
    const byProvider = Object.fromEntries(rows.filter((row) => row.provider).map((row) => [row.provider as string, Number(row.total ?? 0)]));
    const budget = await this.db.select({ monthlyLimitMinor: costBudgets.monthlyLimitMinor, currency: costBudgets.currency })
      .from(costBudgets).where(and(eq(costBudgets.budgetKey, 'user:' + userId), eq(costBudgets.status, 'active'))).limit(1);
    return {
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      providerCostMinor: Object.values(byProvider).reduce((total, value) => total + value, 0),
      byProvider,
      budget: budget[0] ?? null,
      billableUsageIsSeparate: true,
    };
  }

  private monthWindow(at = new Date()) {
    return {
      start: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)),
      end: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)),
    };
  }
}
