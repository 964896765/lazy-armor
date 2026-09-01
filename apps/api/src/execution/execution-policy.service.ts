import { Injectable } from '@nestjs/common';
import { RETRYABLE_ERROR_CODES } from './execution.types';

export interface RetryPolicySnapshot {
  policyVersion: 'p0-5-v1';
  maxAttempts: number;
  initialDelayMs: number;
  backoffStrategy: 'fixed' | 'exponential';
  maxDelayMs: number;
  retryableErrorCodes: string[];
}
export interface FallbackPolicySnapshot { strategy: 'fail_execution' | 'skip_step' | 'pause_plan' | 'require_manual_intervention' }

@Injectable()
export class ExecutionPolicyService {
  readonly retry: RetryPolicySnapshot = Object.freeze({
    policyVersion: 'p0-5-v1',
    maxAttempts: 3,
    initialDelayMs: process.env.NODE_ENV === 'test' ? 25 : 30_000,
    backoffStrategy: 'exponential',
    maxDelayMs: process.env.NODE_ENV === 'test' ? 100 : 120_000,
    retryableErrorCodes: [...RETRYABLE_ERROR_CODES],
  });
  readonly fallback: FallbackPolicySnapshot = Object.freeze({ strategy: 'fail_execution' });
  readonly current = Object.freeze({
    version: 'p0-5-v1',
    maxAttempts: 3,
    initialDelayMs: process.env.NODE_ENV === 'test' ? 25 : 30_000,
    maxDelayMs: process.env.NODE_ENV === 'test' ? 100 : 120_000,
    retryableErrorCodes: RETRYABLE_ERROR_CODES,
    retry: this.retry,
    fallback: this.fallback,
  });

  delayForRetry(retryCount: number, policy: RetryPolicySnapshot = this.retry): number {
    const delay = policy.backoffStrategy === 'fixed' ? policy.initialDelayMs : policy.initialDelayMs * (2 ** Math.max(0, retryCount - 1));
    return Math.min(delay, policy.maxDelayMs);
  }

  resolveRetry(value: unknown): RetryPolicySnapshot {
    const candidate = value as Partial<RetryPolicySnapshot> | null;
    if (!candidate || candidate.policyVersion !== 'p0-5-v1' || !Number.isInteger(candidate.maxAttempts) || !candidate.maxAttempts || candidate.maxAttempts < 1 || candidate.maxAttempts > 10 || !['fixed', 'exponential'].includes(candidate.backoffStrategy ?? '') || !Array.isArray(candidate.retryableErrorCodes)) throw new Error('Invalid resolved retry policy snapshot');
    return candidate as RetryPolicySnapshot;
  }
}
