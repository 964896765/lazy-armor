import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { parseEnv, assertProductionSafe } from '@lazy-armor/config';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { SafeLoggerService } from './common/safe-logger.service';
import { BillingModule } from './billing/billing.module';
import { ContentModule } from './content/content.module';
import { DailySummaryModule } from './daily-summary/daily-summary.module';
import { HouseholdModule } from './household/household.module';
import { LogisticsModule } from './logistics/logistics.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './common/database.module';
import { ConnectionsModule } from './connections/connections.module';
import { ConnectorsModule } from './connectors/connectors.module';
import { HealthModule } from './health/health.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { UsersModule } from './users/users.module';
import { PlansModule } from './plans/plans.module';
import { TemplatesModule } from './templates/templates.module';
import { ExecutionModule } from './execution/execution.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { RiskModule } from './risk/risk.module';
import { AiAdapterModule } from './ai-adapter/ai-adapter.module';
import { AdminModule } from './admin/admin.module';
import { StudyModule } from './study/study.module';
import { DeviceModule } from './device/device.module';
import { DeviceAppsModule } from './device-apps/device-apps.module';
import { TrustedDevicesModule } from './trusted-devices/trusted-devices.module';
import { TruthStoreModule } from './truth-store/truth-store.module';
import { ProfilesModule } from './profiles/profiles.module';
import { OperationsModule } from './operations/operations.module';
import { ObservabilityModule } from './observability/observability.module';
import { MembershipModule } from './membership/membership.module';
import { UsageModule } from './usage/usage.module';
import { SubscriptionBillingModule } from './subscription-billing/subscription-billing.module';
import { CostModule } from './cost/cost.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validate: (env) => {
        const parsed = parseEnv(env as NodeJS.ProcessEnv);
        assertProductionSafe(parsed);
        return parsed;
      },
    }),
    DatabaseModule,
    InfrastructureModule,
    AuthModule,
    UsersModule,
    ConnectorsModule,
    ConnectionsModule,
    HealthModule,
    BillingModule,
    ContentModule,
    DailySummaryModule,
    LogisticsModule,
    HouseholdModule,
    StudyModule,
    DeviceModule,
    TrustedDevicesModule,
    TruthStoreModule,
    DeviceAppsModule,
    ProfilesModule,
    OperationsModule,
    ObservabilityModule,
    MembershipModule,
    UsageModule,
    SubscriptionBillingModule,
    CostModule,
    PlansModule,
    TemplatesModule,
    ExecutionModule,
    ApprovalsModule,
    NotificationsModule,
    AuditModule,
    RiskModule,
    AiAdapterModule,
    AdminModule,
  ],
  providers: [
    SafeLoggerService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
