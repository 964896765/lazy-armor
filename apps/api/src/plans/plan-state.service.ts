import { BadRequestException, Injectable } from '@nestjs/common';
import type { PlanState } from '@lazy-armor/plan-schema';

const TRANSITIONS: Readonly<Record<PlanState, readonly PlanState[]>> = Object.freeze({
  draft: ['ready', 'archived'],
  ready: ['draft', 'active', 'blocked', 'archived'],
  active: ['paused', 'degraded', 'blocked', 'archived'],
  paused: ['active', 'blocked', 'archived'],
  degraded: ['active', 'paused', 'blocked', 'archived'],
  blocked: ['ready', 'active', 'paused', 'archived'],
  archived: [],
});

@Injectable()
export class PlanStateService {
  assertTransition(from: PlanState, to: PlanState): void {
    if (from === to) return;
    if (!TRANSITIONS[from].includes(to)) throw new BadRequestException(`Illegal Plan state transition: ${from} -> ${to}`);
  }

  allowedTransitions(from: PlanState): readonly PlanState[] {
    return TRANSITIONS[from];
  }
}
