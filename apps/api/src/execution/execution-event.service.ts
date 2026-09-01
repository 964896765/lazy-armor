import { Inject, Injectable } from '@nestjs/common';
import { executionEvents } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { SnapshotSanitizer } from '../common/snapshot-sanitizer.service';

@Injectable()
export class ExecutionEventService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly sanitizer: SnapshotSanitizer) {}

  async append(executionId: string, eventType: string, data: unknown = {}, executionStepId: string | null = null, executor: Pick<InjectedDatabase, 'insert'> = this.db) {
    await executor.insert(executionEvents).values({ id: newId(), executionId, executionStepId, eventType, dataJson: this.sanitizer.sanitize(data), createdAt: new Date() });
  }
}
