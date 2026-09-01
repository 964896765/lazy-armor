import { Module } from '@nestjs/common';
import { SnapshotSanitizer } from '../common/snapshot-sanitizer.service';
import { AuditService } from './audit.service';

@Module({
  providers: [SnapshotSanitizer, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
