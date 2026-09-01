import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignatureCheck {
  valid: boolean;
  reason?: 'BAD_SIGNATURE' | 'EXPIRED_TIMESTAMP' | 'FUTURE_TIMESTAMP';
}

// §13/§14：第三方 Webhook 签名校验契约（HMAC-SHA256 + 时间戳新鲜度）。
// 当前 Webhook 仍是用户鉴权端点，此契约供未来公网 Third-party Webhook 复用。
@Injectable()
export class WebhookSignatureVerifier {
  private readonly windowSeconds = 300;

  verify(rawBody: string, signature: string, timestamp: string, secret: string): SignatureCheck {
    const now = Math.floor(Date.now() / 1000);
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return { valid: false, reason: 'BAD_SIGNATURE' };
    if (Math.abs(now - ts) > this.windowSeconds) return { valid: false, reason: now - ts > 0 ? 'EXPIRED_TIMESTAMP' : 'FUTURE_TIMESTAMP' };

    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    const provided = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }
    return { valid: true };
  }
}
