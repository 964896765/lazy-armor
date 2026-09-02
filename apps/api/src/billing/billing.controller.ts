import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { BillingService } from './billing.service';
import { CreateBillingRecordDto, ListBillingRecordsDto } from './dto';

@Controller('billing-records')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateBillingRecordDto) {
    return this.billing.create(user.id, input);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListBillingRecordsDto) {
    return this.billing.list(user.id, query.billingPeriod);
  }

}
