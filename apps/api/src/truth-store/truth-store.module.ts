import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../common/database.module';
import { TruthStoreController } from './truth-store.controller';
import { TruthStoreService } from './truth-store.service';

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [TruthStoreController],
  providers: [TruthStoreService],
  exports: [TruthStoreService],
})
export class TruthStoreModule {}
