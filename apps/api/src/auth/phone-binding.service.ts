import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import type { AuthenticatedUser } from '../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import { LoginCodeService } from './login-code.service';
import { PasswordCredentialService } from './password-credential.service';
import { IdentifierBindingService } from './identifier-binding.service';
import type { StartPhoneBindingDto } from './dto';

@Injectable()
export class PhoneBindingService extends IdentifierBindingService {
  constructor(@Inject(DATABASE) db: InjectedDatabase, config: ConfigService, passwords: PasswordCredentialService, codes: LoginCodeService, limiter: RateLimiterService, audit: AuditService) { super('phone', db, config, passwords, codes, limiter, audit); }
  async capabilities(user: AuthenticatedUser) { return { phoneBinding: await this.bindingCapabilities(user) }; }
  start(user: AuthenticatedUser, input: StartPhoneBindingDto, ip: string) { return this.startBinding(user, { ...input, identifier: input.phone }, ip); }
}
