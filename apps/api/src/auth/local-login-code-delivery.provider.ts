import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LocalLoginCodeDeliveryProvider {
  constructor(private readonly config: ConfigService) {}

  available(endpoint: string | undefined): boolean {
    const appEnv = this.config.get<string>('APP_ENV');
    return this.config.get<string>('NODE_ENV') === 'development'
      && (!appEnv || appEnv === 'development')
      && !endpoint;
  }

  deliver(channel: 'phone' | 'email', identifier: string, code: string, expiresAt: Date): void {
    const endpoint = this.config.get<string>(channel === 'phone'
      ? 'SMS_LOGIN_DELIVERY_ENDPOINT' : 'EMAIL_LOGIN_DELIVERY_ENDPOINT');
    if (!this.available(endpoint)) throw new Error('Local login code delivery is development-only');
    const masked = channel === 'phone'
      ? identifier.slice(0, 5) + '••••' + identifier.slice(-4)
      : identifier.slice(0, 1) + '•••@' + identifier.split('@')[1];
    // Explicit developer console boundary, never Audit, telemetry, API response or client bundle.
    console.info('[LOCAL_LOGIN_CODE]', JSON.stringify({
      channel, account: masked, code, expiresAt: expiresAt.toISOString(),
    }));
  }
}
