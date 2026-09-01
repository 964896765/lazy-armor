import { Injectable } from '@nestjs/common';

@Injectable()
export class ExecutionResultResolver {
  resolve(steps: Array<{ status: string }>): 'succeeded' | 'partially_succeeded' | 'failed' {
    const succeeded = steps.filter((step) => step.status === 'succeeded').length;
    const incomplete = steps.some((step) => ['failed', 'skipped', 'cancelled'].includes(step.status));
    if (succeeded === steps.length) return 'succeeded';
    if (succeeded > 0 && incomplete) return 'partially_succeeded';
    return 'failed';
  }
}
