import { Module } from '@nestjs/common';
import { SnapshotSanitizer } from '../common/snapshot-sanitizer.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [SnapshotSanitizer, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
