import { UserEventsService } from './user-events.service';
import { UserEventSyncRequestsService } from './user-event-sync-requests.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({ imports: [AuditModule, NotificationsModule], controllers: [ProfilesController], providers: [ProfilesService, UserEventsService, UserEventSyncRequestsService], exports: [ProfilesService, UserEventsService, UserEventSyncRequestsService] })
export class ProfilesModule {}
