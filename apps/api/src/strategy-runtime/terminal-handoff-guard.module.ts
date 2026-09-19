import { Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { TerminalHandoffGuard } from './terminal-handoff-guard.service';
import { TruthHandoffGuard } from './truth-handoff-guard.service';

@Module({ imports: [CredentialsModule], providers: [TerminalHandoffGuard, TruthHandoffGuard], exports: [TerminalHandoffGuard, TruthHandoffGuard] })
export class TerminalHandoffGuardModule {}
