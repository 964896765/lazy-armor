import {AuditModule} from '../audit/audit.module';
import {Module} from '@nestjs/common';
import {RuntimeTargetsController} from './runtime-targets.controller';
import {RuntimeTargetsService} from './runtime-targets.service';
@Module({imports:[AuditModule],controllers:[RuntimeTargetsController],providers:[RuntimeTargetsService],exports:[RuntimeTargetsService]})
export class RuntimeTargetsModule {}
