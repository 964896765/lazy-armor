import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({ imports: [AuditModule], controllers: [ProfilesController], providers: [ProfilesService], exports: [ProfilesService] })
export class ProfilesModule {}
