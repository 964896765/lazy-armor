import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { AuditService } from './audit.service';

@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('security-activity')
  listSecurityActivity(@CurrentUser() user: AuthenticatedUser) {
    return this.audit.listSecurityActivity(user.id);
  }
}
