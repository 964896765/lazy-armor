import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { count, and, eq, ne } from 'drizzle-orm';
import { membershipPlans, plans, userMemberships } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import {
  ENTITLEMENT_CATALOG,
  SECURITY_CAPABILITIES,
  isMembershipPlanKey,
  type EntitlementCapability,
  type EntitlementLimit,
  type MembershipPlanKey,
} from './entitlement-catalog';

type MembershipExecutor = Pick<InjectedDatabase, 'select' | 'insert'>;
type MembershipStatus = 'active' | 'trial' | 'past_due' | 'cancelled' | 'expired';

@Injectable()
export class EntitlementService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly audit: AuditService,
  ) {}

  async getEntitlements(userId: string) {
    const membership = await this.membershipRow(userId, this.db);
    const effectivePlanKey = this.effectivePlanKey(membership);
    const catalog = ENTITLEMENT_CATALOG[effectivePlanKey];
    const [activeRows, totalRows] = await Promise.all([
      this.db.select({ value: count(plans.id) }).from(plans)
        .where(and(eq(plans.userId, userId), eq(plans.status, 'active'))),
      this.db.select({ value: count(plans.id) }).from(plans)
        .where(and(eq(plans.userId, userId), ne(plans.status, 'archived'))),
    ]);
    return {
      membership: {
        planKey: membership.membershipPlanKey,
        effectivePlanKey,
        name: catalog.displayName,
        status: membership.status,
        startedAt: membership.startedAt.toISOString(),
        currentPeriodStart: membership.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: membership.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: membership.cancelAtPeriodEnd === 1,
        provider: membership.provider,
      },
      capabilities: { ...catalog.capabilities },
      limits: { ...catalog.limits },
      usage: {
        activePlans: Number(activeRows[0]?.value ?? 0),
        totalPlans: Number(totalRows[0]?.value ?? 0),
      },
      upgrade: {
        available: false,
        mode: 'coming_soon' as const,
      },
    };
  }

  async can(userId: string, capability: EntitlementCapability | string): Promise<boolean> {
    if (SECURITY_CAPABILITIES.has(capability)) return true;
    if (!(capability in ENTITLEMENT_CATALOG.free.capabilities)) return false;
    const membership = await this.membershipRow(userId, this.db);
    return ENTITLEMENT_CATALOG[this.effectivePlanKey(membership)].capabilities[capability as EntitlementCapability];
  }

  async getLimit(userId: string, limitKey: EntitlementLimit): Promise<number> {
    const membership = await this.membershipRow(userId, this.db);
    return ENTITLEMENT_CATALOG[this.effectivePlanKey(membership)].limits[limitKey];
  }

  async assertAllowed(userId: string, capability: EntitlementCapability | string): Promise<void> {
    if (await this.can(userId, capability)) return;
    throw new ForbiddenException({
      code: 'ENTITLEMENT_REQUIRED',
      message: '当前套餐暂不包含这项高级能力。',
    });
  }

  async assertPlanActivationAllowed(userId: string, planId: string, executor: MembershipExecutor): Promise<void> {
    const membership = await this.membershipRow(userId, executor, true);
    const effectivePlanKey = this.effectivePlanKey(membership);
    const limit = ENTITLEMENT_CATALOG[effectivePlanKey].limits.max_active_plans;
    // The membership row was locked before this transaction established a
    // consistent snapshot, so this count sees the preceding activation commit.
    const activeRows = await executor.select({ value: count(plans.id) }).from(plans)
      .where(and(eq(plans.userId, userId), eq(plans.status, 'active'), ne(plans.id, planId)));
    const activePlans = Number(activeRows[0]?.value ?? 0);
    if (activePlans >= limit) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        message: ENTITLEMENT_CATALOG[effectivePlanKey].displayName + '最多可以同时启用 ' + limit + ' 个计划。',
      });
    }
  }

  async setForInternalFixture(
    userId: string,
    planKey: MembershipPlanKey,
    status: MembershipStatus,
    periodEnd: Date | null = null,
  ) {
    if (process.env.NODE_ENV !== 'test') throw new ForbiddenException('Membership fixture is test-only');
    if (!isMembershipPlanKey(planKey)) throw new ForbiddenException('Unknown membership plan');
    const now = new Date();
    await this.db.insert(userMemberships).values({
      id: newId(),
      userId,
      membershipPlanKey: planKey,
      status,
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: 0,
      provider: 'internal_fixture',
      externalSubscriptionId: null,
      createdAt: now,
      updatedAt: now,
    }).onDuplicateKeyUpdate({ set: {
      membershipPlanKey: planKey,
      status,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: 0,
      provider: 'internal_fixture',
      externalSubscriptionId: null,
      updatedAt: now,
    } });
    await this.audit.append({
      actorType: 'system',
      actorUserId: null,
      action: 'MEMBERSHIP_INTERNAL_FIXTURE_CHANGED',
      resourceType: 'user_membership',
      resourceId: userId,
      userId,
      source: 'api',
      result: 'success',
      changeSummary: 'Membership fixture set to ' + planKey + '/' + status,
    });
    return this.getEntitlements(userId);
  }

  private async membershipRow(userId: string, executor: MembershipExecutor, lock = false) {
    const query = executor.select({
      id: userMemberships.id,
      membershipPlanKey: userMemberships.membershipPlanKey,
      status: userMemberships.status,
      startedAt: userMemberships.startedAt,
      currentPeriodStart: userMemberships.currentPeriodStart,
      currentPeriodEnd: userMemberships.currentPeriodEnd,
      cancelAtPeriodEnd: userMemberships.cancelAtPeriodEnd,
      provider: userMemberships.provider,
    }).from(userMemberships)
      .where(eq(userMemberships.userId, userId))
      .limit(1);
    let rows = lock ? await query.for('update') : await query;
    if (!rows[0]) {
      const now = new Date();
      await executor.insert(userMemberships).values({
        id: newId(),
        userId,
        membershipPlanKey: 'free',
        status: 'active',
        startedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: 0,
        provider: 'internal',
        externalSubscriptionId: null,
        createdAt: now,
        updatedAt: now,
      }).onDuplicateKeyUpdate({ set: { userId } });
      rows = lock ? await query.for('update') : await query;
    }
    const membership = rows[0];
    if (!membership) throw new ForbiddenException('Membership is unavailable');
    const catalog = await executor.select({ status: membershipPlans.status }).from(membershipPlans)
      .where(eq(membershipPlans.planKey, membership.membershipPlanKey))
      .limit(1);
    return { ...membership, catalogStatus: catalog[0]?.status ?? 'disabled' };
  }

  private effectivePlanKey(membership: {
    membershipPlanKey: string;
    status: string;
    currentPeriodEnd: Date | null;
    catalogStatus: string;
  }): MembershipPlanKey {
    const eligible = membership.catalogStatus === 'active'
      && ['active', 'trial'].includes(membership.status)
      && (!membership.currentPeriodEnd || membership.currentPeriodEnd > new Date());
    return eligible && isMembershipPlanKey(membership.membershipPlanKey)
      ? membership.membershipPlanKey
      : 'free';
  }
}
