import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { AuditService } from './audit.service';
import { CursorPageDto } from '../common/cursor-pagination';

@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('security-activity')
  listSecurityActivity(@CurrentUser() user: AuthenticatedUser) {
    return this.audit.listSecurityActivity(user.id);
  }

  @Get('audit/page')
  listPage(@CurrentUser() user: AuthenticatedUser, @Query() query: CursorPageDto) {
    return this.audit.listPage(user.id, query);
  }
}
