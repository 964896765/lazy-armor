import { Controller, Get } from '@nestjs/common';
import { Roles, type AuthenticatedUser } from '../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { DiagnosticsService } from '../diagnostics/diagnostics.service';
import { CurrentUser } from '../common/auth-context';
import { ConnectorsService } from '../connectors/connectors.service';
import { AdminOperationsService } from './admin-operations.service';
import { OperationalAlertsService } from '../observability/operational-alerts.service';

// 运营只读诊断入口。P0 Final 不开放任何生产写操作（outcome_unknown 人工处置留待 P1）。
@Controller('admin')
export class AdminController {
  constructor(
    private readonly diagnostics: DiagnosticsService,
    private readonly audit: AuditService,
    private readonly connectors: ConnectorsService,
    private readonly operations: AdminOperationsService,
    private readonly alerts: OperationalAlertsService,
  ) {}

  @Get('diagnostics')
  @Roles('super_admin', 'operations_readonly')
  async viewDiagnostics(@CurrentUser() user: AuthenticatedUser) {
    const snapshot = await this.diagnostics.snapshot();
    await this.audit.append({ actorType: 'user', actorUserId: user.id, action: 'ADMIN_DIAGNOSTICS_VIEWED', resourceType: 'system', resourceId: 'diagnostics', userId: user.id, source: 'api', result: 'success', changeSummary: `Admin (${user.role}) viewed operational diagnostics` });
    return snapshot;
  }

  @Get('diagnostics/connectors')
  @Roles('super_admin', 'operations_readonly')
  async viewConnectorContracts(@CurrentUser() user: AuthenticatedUser) {
    const matrix = this.connectors.listInternal();
    await this.audit.append({ actorType: 'user', actorUserId: user.id, action: 'ADMIN_CONNECTOR_CONTRACTS_VIEWED', resourceType: 'system', resourceId: 'connector-contracts', userId: user.id, source: 'api', result: 'success', changeSummary: `Admin (${user.role}) viewed connector contracts` });
    return matrix;
  }

  @Get('operations/overview')
  @Roles('super_admin', 'operations_readonly')
  async viewOperationsOverview(@CurrentUser() user: AuthenticatedUser) {
    const snapshot = await this.operations.overview();
    await this.audit.append({ actorType: 'user', actorUserId: user.id, action: 'ADMIN_OPERATIONS_OVERVIEW_VIEWED', resourceType: 'system', resourceId: 'operations-overview', userId: user.id, source: 'api', result: 'success', changeSummary: `Admin (${user.role}) viewed operations overview` });
    return snapshot;
  }

  @Get('operations/workers')
  @Roles('super_admin', 'operations_readonly')
  async viewWorkerStatus(@CurrentUser() user: AuthenticatedUser) {
    const workers = await this.operations.workers();
    await this.audit.append({ actorType: 'user', actorUserId: user.id, action: 'ADMIN_WORKER_STATUS_VIEWED', resourceType: 'system', resourceId: 'operations-workers', userId: user.id, source: 'api', result: 'success', changeSummary: `Admin (${user.role}) viewed worker status` });
    return workers;
  }

  @Get('operations/outbox')
  @Roles('super_admin', 'operations_readonly')
  async viewOutboxStatus(@CurrentUser() user: AuthenticatedUser) {
    const outbox = await this.operations.outbox();
    await this.audit.append({ actorType: 'user', actorUserId: user.id, action: 'ADMIN_OUTBOX_STATUS_VIEWED', resourceType: 'system', resourceId: 'operations-outbox', userId: user.id, source: 'api', result: 'success', changeSummary: `Admin (${user.role}) viewed outbox status` });
    return outbox;
  }

  @Get('operations/executions')
  @Roles('super_admin', 'operations_readonly')
  async viewExecutionStatus(@CurrentUser() user: AuthenticatedUser) {
    const executions = await this.operations.executions();
    await this.audit.append({ actorType: 'user', actorUserId: user.id, action: 'ADMIN_EXECUTION_STATUS_VIEWED', resourceType: 'system', resourceId: 'operations-executions', userId: user.id, source: 'api', result: 'success', changeSummary: `Admin (${user.role}) viewed execution status` });
    return executions;
  }

  @Get('operations/connectors')
  @Roles('super_admin', 'operations_readonly')
  async viewConnectorHealth(@CurrentUser() user: AuthenticatedUser) {
    const connectors = await this.operations.connectorsSummary();
    await this.audit.append({ actorType: 'user', actorUserId: user.id, action: 'ADMIN_CONNECTOR_HEALTH_VIEWED', resourceType: 'system', resourceId: 'operations-connectors', userId: user.id, source: 'api', result: 'success', changeSummary: `Admin (${user.role}) viewed connector health` });
    return connectors;
  }

  @Get('operations/alerts')
  @Roles('super_admin', 'operations_readonly')
  async viewOperationalAlerts(@CurrentUser() user: AuthenticatedUser) {
    const alerts = await this.alerts.list();
    await this.audit.append({ actorType: 'user', actorUserId: user.id, action: 'ADMIN_OPERATIONAL_ALERTS_VIEWED', resourceType: 'system', resourceId: 'operations-alerts', userId: user.id, source: 'api', result: 'success', changeSummary: `Admin (${user.role}) viewed operational alerts` });
    return alerts;
  }
}
