import { AsyncLocalStorage } from 'node:async_hooks';
import { ConflictException } from '@nestjs/common';

// Carries the existing lease identity across Runner awaits; no new authority.
export const executionOwnerContext = new AsyncLocalStorage<{ executionId:string; workerToken:string }>();
export function assertExecutionOwner(row:{id:string;workerToken:string|null;leaseExpiresAt:Date|null}) {
  const owner=executionOwnerContext.getStore();
  if(!owner)return; // Approval/Outbox/administrative authorities keep their own paths.
  if(owner.executionId!==row.id||owner.workerToken!==row.workerToken||!row.leaseExpiresAt||row.leaseExpiresAt.getTime()<=Date.now())throw new ConflictException('STALE_EXECUTION_LEASE');
}
