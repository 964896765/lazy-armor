import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database.module';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
