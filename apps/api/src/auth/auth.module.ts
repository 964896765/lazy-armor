import { LocalLoginCodeDeliveryProvider } from './local-login-code-delivery.provider';
import { LoginCodeService } from './login-code.service';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordResetDeliveryService } from './password-reset-delivery.service';
import { IdentityResolverService } from './identity-resolver.service';
import { PasswordCredentialService } from './password-credential.service';
import { EmailBindingService } from './email-binding.service';
import { PasswordRecoveryService } from './password-recovery.service';

@Module({
  imports: [AuditModule, JwtModule.registerAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET'), signOptions: { expiresIn: '1h' } }),
  })],
  controllers: [AuthController],
  providers: [LocalLoginCodeDeliveryProvider, LoginCodeService, PasswordCredentialService, IdentityResolverService, AuthService, EmailBindingService, PasswordResetDeliveryService, PasswordRecoveryService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
