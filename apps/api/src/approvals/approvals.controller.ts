import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ApprovalService } from './approval.service';
import { ApprovalDecisionDto, CreateTemporaryAuthorizationDto } from './dto';
import { TemporaryAuthorizationService } from './temporary-authorization.service';

@Controller()
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalService, private readonly authorizations: TemporaryAuthorizationService) {}
  @Get('approvals') list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) { return this.approvals.list(user.id, status); }
  @Get('approvals/:id') get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.approvals.get(user.id, id); }
  @Post('approvals/:id/approve') approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: ApprovalDecisionDto) { return this.approvals.approve(user.id, id, input); }
  @Post('approvals/:id/reject') reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: ApprovalDecisionDto) { return this.approvals.reject(user.id, id, input); }
  @Get('temporary-authorizations') authorizationsList(@CurrentUser() user: AuthenticatedUser) { return this.authorizations.list(user.id); }
  @Post('temporary-authorizations') authorizationCreate(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateTemporaryAuthorizationDto) { return this.authorizations.create(user.id, input); }
  @Post('temporary-authorizations/:id/revoke') authorizationRevoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.authorizations.revoke(user.id, id); }
}
