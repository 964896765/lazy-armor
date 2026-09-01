import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CreateLogisticsTrackingSnapshotDto, ListLogisticsTrackingSnapshotsDto } from './dto';
import { LogisticsService } from './logistics.service';

@Controller('logistics-tracking-snapshots')
export class LogisticsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateLogisticsTrackingSnapshotDto) {
    return this.logistics.create(user.id, input);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListLogisticsTrackingSnapshotsDto) {
    return this.logistics.list(user.id, query.trackingNumber);
  }
}
