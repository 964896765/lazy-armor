import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { userMemberships } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { isMembershipPlanKey, type MembershipPlanKey } from './entitlement-catalog';

export type MembershipStatus = 'active' | 'trial' | 'past_due' | 'cancelled' | 'expired';
type MembershipLifecycleExecutor = Pick<InjectedDatabase, 'insert'>;

@Injectable()
export class MembershipLifecycleService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly audit: AuditService,
  ) {}

  async applySubscriptionState(input: {
    userId: string;
    planKey: MembershipPlanKey;
    status: MembershipStatus;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    provider: string;
    externalSubscriptionId: string;
    eventId: string;
  }, executor: MembershipLifecycleExecutor = this.db) {
    if (!isMembershipPlanKey(input.planKey)) throw new BadRequestException('Unknown membership plan');
    const now = new Date();
    await executor.insert(userMemberships).values({
      id: newId(),
      userId: input.userId,
      membershipPlanKey: input.planKey,
      status: input.status,
      startedAt: input.currentPeriodStart ?? now,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ? 1 : 0,
      provider: input.provider,
      externalSubscriptionId: input.externalSubscriptionId,
      createdAt: now,
      updatedAt: now,
    }).onDuplicateKeyUpdate({ set: {
      membershipPlanKey: input.planKey,
      status: input.status,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ? 1 : 0,
      provider: input.provider,
      externalSubscriptionId: input.externalSubscriptionId,
      updatedAt: now,
    } });
    await this.audit.append({
      actorType: 'system',
      actorUserId: null,
      action: 'MEMBERSHIP_SUBSCRIPTION_STATE_APPLIED',
      resourceType: 'user_membership',
      resourceId: input.userId,
      userId: input.userId,
      requestId: input.eventId,
      source: 'system',
      result: 'success',
      changeSummary: 'Subscription state applied: ' + input.planKey + '/' + input.status,
      after: {
        planKey: input.planKey,
        status: input.status,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        currentPeriodEnd: input.currentPeriodEnd?.toISOString() ?? null,
        provider: input.provider,
      },
    }, executor);
  }
}
