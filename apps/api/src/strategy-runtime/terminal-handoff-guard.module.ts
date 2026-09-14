import { Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { TerminalHandoffGuard } from './terminal-handoff-guard.service';
@Module({ imports: [CredentialsModule], providers: [TerminalHandoffGuard], exports: [TerminalHandoffGuard] })
export class TerminalHandoffGuardModule {}
