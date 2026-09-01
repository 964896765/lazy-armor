import { Injectable } from '@nestjs/common';
import type { NotificationPriority } from './notification.service';

const PRIORITY_SCORE: Record<NotificationPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const EVENT_FLOORS: Record<string, NotificationPriority> = {
  security_risk: 'P0',
  p0_7_safety_gate_blocked: 'P0',
  approval_required: 'P1',
  execution_failed: 'P1',
  approval_rejected: 'P2',
  approval_expired: 'P2',
  execution_succeeded: 'P3',
};

@Injectable()
export class NotificationPolicyService {
  resolve(eventType: string, requested: NotificationPriority): NotificationPriority {
    const floor = EVENT_FLOORS[eventType] ?? requested;
    return PRIORITY_SCORE[floor] <= PRIORITY_SCORE[requested] ? floor : requested;
  }
}
