import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CreateOperationalRecordDto } from './dto';
import { OperationsService } from './operations.service';

@Controller('operational-records')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateOperationalRecordDto) { return this.operations.create(user.id, input); }
  @Get() list(@CurrentUser() user: AuthenticatedUser) { return this.operations.list(user.id); }
}
