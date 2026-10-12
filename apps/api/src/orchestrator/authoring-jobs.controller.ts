import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { AuthoringJobsService } from './authoring-jobs.service';

/** Existing global AuthGuard applies; ownership is checked by the service. */
@Controller('authoring-jobs')
export class AuthoringJobsController {
  constructor(private readonly jobs: AuthoringJobsService) {}
  @Get(':id') get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.jobs.get(user.id, id); }
  @Post(':id/cancel') cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.jobs.cancel(user.id, id); }
}
