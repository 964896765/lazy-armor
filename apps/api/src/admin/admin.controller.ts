import { Controller, Get } from '@nestjs/common';
import { Roles, type AuthenticatedUser } from '../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { DiagnosticsService } from '../diagnostics/diagnostics.service';
import { CurrentUser } from '../common/auth-context';

// 运营只读诊断入口。P0 Final 不开放任何生产写操作（outcome_unknown 人工处置留待 P1）。
@Controller('admin')
export class AdminController {
  constructor(private readonly diagnostics: DiagnosticsService, private readonly audit: AuditService) {}

  @Get('diagnostics')
  @Roles('super_admin', 'operations_readonly')
  async viewDiagnostics(@CurrentUser() user: AuthenticatedUser) {
    const snapshot = await this.diagnostics.snapshot();
    await this.audit.append({ actorType: 'user', actorUserId: user.id, action: 'ADMIN_DIAGNOSTICS_VIEWED', resourceType: 'system', resourceId: 'diagnostics', userId: user.id, source: 'api', result: 'success', changeSummary: `Admin (${user.role}) viewed operational diagnostics` });
    return snapshot;
  }
}
