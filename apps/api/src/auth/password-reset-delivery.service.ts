import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PasswordResetDeliveryStatus = 'delivered' | 'unavailable' | 'failed';

export interface PasswordResetDeliveryInput {
  email: string;
  token: string;
  expiresAt: Date;
}

/**
 * A deliberately narrow outbound boundary for password reset messages.
 * It never logs or persists a raw reset token. A deployment without a configured
 * delivery gateway is treated as unavailable, so a usable token is never issued
 * without a defined path to its account owner.
 */
@Injectable()
export class PasswordResetDeliveryService {
  constructor(private readonly config: ConfigService) {}

  async deliver(input: PasswordResetDeliveryInput): Promise<PasswordResetDeliveryStatus> {
    const endpoint = this.config.get<string>('PASSWORD_RESET_DELIVERY_ENDPOINT');
    const token = this.config.get<string>('PASSWORD_RESET_DELIVERY_TOKEN');
    if (!endpoint || !token) return 'unavailable';

    const resetUrl = `lazyarmor://auth/reset-password?token=${encodeURIComponent(input.token)}`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'password_reset',
          recipientEmail: input.email,
          resetUrl,
          expiresAt: input.expiresAt.toISOString(),
        }),
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok ? 'delivered' : 'failed';
    } catch {
      return 'failed';
    }
  }
}
