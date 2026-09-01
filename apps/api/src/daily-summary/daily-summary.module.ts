import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database.module';
import { ConnectionsModule } from '../connections/connections.module';
import { DailySummaryController } from './daily-summary.controller';
import { DailySummaryService } from './daily-summary.service';

@Module({
  imports: [DatabaseModule, ConnectionsModule],
  controllers: [DailySummaryController],
  providers: [DailySummaryService],
  exports: [DailySummaryService],
})
export class DailySummaryModule {}
