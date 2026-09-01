// Notification 外部投递基础接口（P0-7 只做可插拔骨架，不发送真实 Push/SMS/Email）。
// 未来 Push/SMS/Email 通过 Outbox 接入：eventType 前缀 'notification.deliver.*'。
export interface NotificationDeliveryRequest {
  userId: string;
  channel: 'push' | 'email' | 'sms' | 'test';
  notificationId: string;
  recipient?: string | null;
  title: string;
  body: string;
  dedupeKey: string;
}

export interface NotificationDeliveryResult {
  delivered: boolean;
  providerReference?: string | null;
  reasonCode?: string | null;
}

export interface NotificationDeliveryAdapter {
  readonly channel: string;
  deliver(request: NotificationDeliveryRequest): Promise<NotificationDeliveryResult>;
}

// 默认 No-op Adapter：证明外部投递可接入 Outbox，但本阶段不真正外发。
export class NoopNotificationDeliveryAdapter implements NotificationDeliveryAdapter {
  readonly channel = 'noop';
  async deliver(request: NotificationDeliveryRequest): Promise<NotificationDeliveryResult> {
    return { delivered: false, providerReference: null, reasonCode: 'NOOP_ADAPTER' };
  }
}
