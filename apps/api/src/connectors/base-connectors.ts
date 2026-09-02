import { createHash } from 'crypto';
import {
  ConnectorError,
  type AuthorizationCallbackRequest,
  type AuthorizationCallbackResult,
  type AuthorizationStartRequest,
  type AuthorizationStartResult,
  type ConnectionHealth,
  type Connector,
  type ConnectorCapability,
  type ConnectorMetadata,
  type ConnectorRequest,
  type ConnectorResult,
  type CredentialRefreshRequest,
  type CredentialRefreshResult,
  type SubscriptionRequest,
} from '@lazy-armor/connector-sdk';

abstract class BaseConnector implements Connector {
  abstract metadata(): ConnectorMetadata;
  abstract capabilities(): ConnectorCapability[];
  async validateConnection(): Promise<ConnectionHealth> {
    return { status: 'healthy' as const, checkedAt: new Date().toISOString() };
  }
  async revoke(): Promise<void> {}
}

export class ManualConnector extends BaseConnector {
  metadata = () => ({
    key: 'manual',
    name: '手动输入',
    description: '由用户手动提供数据',
    version: '1.0.0',
    providerType: 'manual' as const,
    productionStatus: 'PRODUCTION_READY' as const,
    authentication: { type: 'none' as const },
    supportsRefresh: false,
    supportsRevoke: false,
    supportsWebhook: false,
    supportsHealthCheck: true,
    sandboxSupport: 'full' as const,
    rateLimitStrategy: 'unknown' as const,
  });
  capabilities = (): ConnectorCapability[] => [
    { key: 'MANUAL_INPUT', name: '提交手动输入', userFacingName: '手动输入', riskLevel: 'R0', operation: 'read', requiredPermission: 'MANUAL_INPUT', providerAvailability: 'available' },
  ];
  async read(request: ConnectorRequest): Promise<ConnectorResult> {
    return { ok: true, data: { accepted: true, input: request.input, requestId: request.requestId } };
  }
}

export class InternalConnector extends BaseConnector {
  metadata = () => ({
    key: 'internal',
    name: '内部服务',
    description: '读写懒人装甲内部数据',
    version: '1.0.0',
    providerType: 'internal' as const,
    productionStatus: 'PRODUCTION_READY' as const,
    authentication: { type: 'none' as const },
    supportsRefresh: false,
    supportsRevoke: false,
    supportsWebhook: false,
    supportsHealthCheck: true,
    sandboxSupport: 'full' as const,
    rateLimitStrategy: 'unknown' as const,
  });
  capabilities = (): ConnectorCapability[] => [
    { key: 'READ_INTERNAL', name: '读取内部数据', userFacingName: '读取内部数据', riskLevel: 'R0', operation: 'read', requiredPermission: 'READ_INTERNAL', providerAvailability: 'available' },
    { key: 'WRITE_INTERNAL', name: '写入内部数据', userFacingName: '写入内部数据', riskLevel: 'R1', operation: 'execute', requiredPermission: 'WRITE_INTERNAL', providerAvailability: 'available' },
  ];
  async read(request: ConnectorRequest): Promise<ConnectorResult> {
    return { ok: true, data: { source: 'internal', input: request.input } };
  }
  async execute(request: ConnectorRequest): Promise<ConnectorResult> {
    return { ok: true, data: { recorded: true, idempotencyKey: request.idempotencyKey ?? null } };
  }
}

export class WebhookConnector extends BaseConnector {
  metadata = () => ({
    key: 'webhook',
    name: 'Webhook',
    description: '接收标准 Webhook 事件',
    version: '1.0.0',
    providerType: 'webhook' as const,
    productionStatus: 'BETA' as const,
    authentication: { type: 'api_key' as const },
    supportsRefresh: false,
    supportsRevoke: true,
    supportsWebhook: true,
    supportsHealthCheck: true,
    sandboxSupport: 'limited' as const,
    rateLimitStrategy: 'provider_managed' as const,
  });
  capabilities = (): ConnectorCapability[] => [
    { key: 'RECEIVE_WEBHOOK', name: '接收 Webhook 事件', userFacingName: '接收 Webhook 事件', riskLevel: 'R0', operation: 'subscribe', requiredPermission: 'RECEIVE_WEBHOOK', providerAvailability: 'available' },
  ];
  async subscribe(request: SubscriptionRequest): Promise<ConnectorResult> {
    return { ok: true, data: { subscribed: true, callbackUrl: request.callbackUrl ?? null } };
  }
}

function mustCredential(request: ConnectorRequest) {
  const credential = request.credentials?.data;
  if (!credential?.accessToken) throw new ConnectorError('AUTH_REQUIRED', 'AUTH_REQUIRED', 'Provider credential is missing');
  return credential;
}

function isoAfterMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function mailboxFor(key: string) {
  const inboxes: Record<string, Array<Record<string, unknown>>> = {
    primary: [
      {
        messageId: 'msg-100',
        threadId: 'thr-100',
        subject: '今天 16:00 前请确认合同',
        from: 'legal@example.com',
        to: ['user@example.com'],
        occurredAt: '2027-04-06T07:30:00.000Z',
        labels: ['INBOX', 'IMPORTANT'],
        hasAttachments: true,
        plainText: '请在今天 16:00 前确认最新版合同。',
        attachments: [{ name: 'contract.pdf', size: 1024 }],
      },
      {
        messageId: 'msg-101',
        threadId: 'thr-101',
        subject: '周报草稿已准备',
        from: 'bot@example.com',
        to: ['user@example.com'],
        occurredAt: '2027-04-06T06:00:00.000Z',
        labels: ['INBOX'],
        hasAttachments: false,
        plainText: '本周周报草稿已准备。',
        attachments: [],
      },
    ],
    work: [
      {
        messageId: 'msg-200',
        threadId: 'thr-200',
        subject: '明天上午例会资料',
        from: 'pm@example.com',
        to: ['user@example.com'],
        occurredAt: '2027-04-06T04:00:00.000Z',
        labels: ['INBOX'],
        hasAttachments: false,
        plainText: '请提前看一下明天例会资料。',
        attachments: [],
      },
    ],
  };
  return inboxes[key] ?? inboxes.primary;
}

function calendarFor(key: string) {
  const calendars: Record<string, Array<Record<string, unknown>>> = {
    primary: [
      {
        id: 'evt-100',
        title: '项目例会',
        startAt: '2027-04-06T09:00:00.000Z',
        endAt: '2027-04-06T10:00:00.000Z',
        timezone: 'Asia/Shanghai',
        location: '会议室 A',
        organizer: 'pm@example.com',
        attendeesSummary: '4 位参会人',
        status: 'confirmed',
      },
      {
        id: 'evt-101',
        title: '教资复习时间',
        startAt: '2027-04-06T20:00:00.000Z',
        endAt: '2027-04-06T21:00:00.000Z',
        timezone: 'Asia/Shanghai',
        location: '家里',
        organizer: 'user@example.com',
        attendeesSummary: '仅自己',
        status: 'confirmed',
      },
    ],
  };
  return calendars[key] ?? calendars.primary;
}

abstract class OAuthConnectorBase extends BaseConnector {
  protected abstract providerKey(): string;
  protected abstract externalAccountPrefix(): string;

  async startAuthorization(request: AuthorizationStartRequest): Promise<AuthorizationStartResult> {
    return {
      authorizationUrl: `https://auth.example.test/${this.providerKey()}?state=${encodeURIComponent(request.state)}&redirect_uri=${encodeURIComponent(request.redirectUri)}`,
      expiresAt: isoAfterMinutes(10),
    };
  }

  protected buildCredential(code: string, defaults?: Record<string, string>): AuthorizationCallbackResult {
    const normalized = code.trim().toLowerCase();
    const mailboxKey = normalized.includes('work') ? 'work' : 'primary';
    const startsExpired = normalized.includes('expired') || normalized.includes('refresh-invalid');
    const credentials: Record<string, string> = {
      accessToken: `access-${normalized}`,
      refreshToken: `refresh-${normalized}`,
      expiresAt: startsExpired ? new Date(Date.now() - 60_000).toISOString() : isoAfterMinutes(30),
      refreshBehavior: normalized.includes('refresh-invalid') ? 'invalid' : 'ok',
      dataKey: mailboxKey,
      ...defaults,
    };
    return {
      externalAccountName: `${this.externalAccountPrefix()}-${mailboxKey}`,
      credentials,
      expiresAt: credentials.expiresAt,
    };
  }

  async refreshCredentials(request: CredentialRefreshRequest): Promise<CredentialRefreshResult> {
    if (!request.credential.refreshToken) throw new ConnectorError('AUTH_REQUIRED', 'AUTH_REQUIRED', 'Missing refresh token');
    if (request.credential.refreshBehavior === 'invalid') {
      throw new ConnectorError('REFRESH_INVALID', 'AUTH_REQUIRED', 'Refresh token is invalid');
    }
    return {
      credentials: {
        ...request.credential,
        accessToken: `access-refreshed-${Date.now()}`,
        expiresAt: isoAfterMinutes(45),
      },
      expiresAt: isoAfterMinutes(45),
    };
  }
}

export class GmailConnector extends OAuthConnectorBase {
  metadata = () => ({
    key: 'gmail',
    name: 'Gmail',
    description: '读取邮件标题、内容，并准备邮件草稿。',
    version: '0.1.0',
    providerType: 'email' as const,
    productionStatus: 'BETA' as const,
    authentication: {
      type: 'oauth2' as const,
      oauth2: {
        authorizationCapability: 'AUTHORIZE_GMAIL',
        supportsRefresh: true,
        supportsRevoke: true,
        supportsPKCE: true,
        requiresRedirect: true,
      },
    },
    supportsRefresh: true,
    supportsRevoke: true,
    supportsWebhook: false,
    supportsHealthCheck: true,
    sandboxSupport: 'limited' as const,
    rateLimitStrategy: 'retry_after' as const,
  });

  capabilities = (): ConnectorCapability[] => [
    { key: 'READ_EMAIL_METADATA', name: '读取邮件元数据', userFacingName: '读取邮件标题和时间', riskLevel: 'R0', operation: 'read', requiredPermission: 'READ_EMAIL_METADATA', providerAvailability: 'beta' },
    { key: 'READ_EMAIL', name: '读取邮件内容', userFacingName: '读取邮件内容', riskLevel: 'R0', operation: 'read', requiredPermission: 'READ_EMAIL', providerAvailability: 'beta' },
    {
      key: 'CREATE_DRAFT',
      name: '创建邮件草稿',
      userFacingName: '准备邮件草稿',
      riskLevel: 'R2',
      operation: 'execute',
      requiredPermission: 'CREATE_DRAFT',
      providerAvailability: 'beta',
      sideEffectContract: { sideEffect: true, supportsIdempotencyKey: false, supportsOperationLookup: false, retrySafety: 'ambiguous' },
    },
  ];

  protected providerKey() { return 'gmail'; }
  protected externalAccountPrefix() { return 'gmail'; }

  async completeAuthorization(request: AuthorizationCallbackRequest): Promise<AuthorizationCallbackResult> {
    if (request.code.trim().toLowerCase() === 'rate-limited') {
      throw new ConnectorError('RATE_LIMITED', 'RATE_LIMITED', 'Provider is throttling authorization', { retryable: true, retryAfterMs: 30000 });
    }
    return {
      ...this.buildCredential(request.code),
      grantedCapabilities: ['READ_EMAIL_METADATA', 'READ_EMAIL', 'CREATE_DRAFT'],
    };
  }

  async validateConnection(request?: ConnectorRequest): Promise<ConnectionHealth> {
    const credential = request?.credentials?.data;
    if (!credential?.accessToken) return { status: 'reauthorization_required', checkedAt: new Date().toISOString(), reason: 'missing_access_token' };
    if (credential.expiresAt && new Date(credential.expiresAt) <= new Date()) {
      return { status: credential.refreshToken ? 'degraded' : 'reauthorization_required', checkedAt: new Date().toISOString(), reason: 'token_expired' };
    }
    return { status: 'healthy', checkedAt: new Date().toISOString() };
  }

  async read(request: ConnectorRequest): Promise<ConnectorResult> {
    const credential = mustCredential(request);
    if (request.input.mode === 'rate_limit') {
      throw new ConnectorError('RATE_LIMITED', 'RATE_LIMITED', 'Gmail rate limited', { retryable: true, retryAfterMs: 15000 });
    }
    if (request.input.mode === 'provider_unavailable') {
      throw new ConnectorError('PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'Gmail provider unavailable', { retryable: true });
    }
    const mailbox = mailboxFor(credential.dataKey ?? 'primary');
    if (request.capability === 'READ_EMAIL_METADATA') {
      return {
        ok: true,
        data: {
          messages: mailbox.map((item) => ({
            messageId: item.messageId,
            threadId: item.threadId,
            subject: item.subject,
            from: item.from,
            to: item.to,
            occurredAt: item.occurredAt,
            labels: item.labels,
            hasAttachments: item.hasAttachments,
          })),
        },
      };
    }
    if (request.capability === 'READ_EMAIL') {
      return {
        ok: true,
        data: {
          messages: mailbox.map((item) => ({
            messageId: item.messageId,
            threadId: item.threadId,
            subject: item.subject,
            from: item.from,
            to: item.to,
            occurredAt: item.occurredAt,
            labels: item.labels,
            hasAttachments: item.hasAttachments,
            plainText: item.plainText,
            attachments: item.attachments,
          })),
        },
      };
    }
    throw new ConnectorError('INVALID_CAPABILITY', 'INVALID_REQUEST', `Unsupported capability: ${request.capability}`);
  }

  async execute(request: ConnectorRequest): Promise<ConnectorResult> {
    mustCredential(request);
    if (request.capability !== 'CREATE_DRAFT') {
      throw new ConnectorError('INVALID_CAPABILITY', 'INVALID_REQUEST', `Unsupported capability: ${request.capability}`);
    }
    return {
      ok: true,
      data: {
        draftId: `draft-${request.requestId}`,
        threadId: `draft-thread-${request.requestId}`,
        subject: request.input.subject ?? '未命名草稿',
        created: true,
      },
    };
  }
}

export class GoogleCalendarConnector extends OAuthConnectorBase {
  metadata = () => ({
    key: 'google_calendar',
    name: 'Google Calendar',
    description: '读取日历事件与可用时间。',
    version: '0.1.0',
    providerType: 'calendar' as const,
    productionStatus: 'BETA' as const,
    authentication: {
      type: 'oauth2' as const,
      oauth2: {
        authorizationCapability: 'AUTHORIZE_CALENDAR',
        supportsRefresh: true,
        supportsRevoke: true,
        supportsPKCE: true,
        requiresRedirect: true,
      },
    },
    supportsRefresh: true,
    supportsRevoke: true,
    supportsWebhook: false,
    supportsHealthCheck: true,
    sandboxSupport: 'limited' as const,
    rateLimitStrategy: 'retry_after' as const,
  });

  capabilities = (): ConnectorCapability[] => [
    { key: 'READ_EVENT', name: '读取日历事件', userFacingName: '读取日历事件', riskLevel: 'R0', operation: 'read', requiredPermission: 'READ_EVENT', providerAvailability: 'beta' },
  ];

  protected providerKey() { return 'google_calendar'; }
  protected externalAccountPrefix() { return 'calendar'; }

  async completeAuthorization(request: AuthorizationCallbackRequest): Promise<AuthorizationCallbackResult> {
    return {
      ...this.buildCredential(request.code, { calendarKey: 'primary' }),
      grantedCapabilities: ['READ_EVENT'],
    };
  }

  async validateConnection(request?: ConnectorRequest): Promise<ConnectionHealth> {
    const credential = request?.credentials?.data;
    if (!credential?.accessToken) return { status: 'reauthorization_required', checkedAt: new Date().toISOString(), reason: 'missing_access_token' };
    if (credential.expiresAt && new Date(credential.expiresAt) <= new Date()) {
      return { status: credential.refreshToken ? 'degraded' : 'reauthorization_required', checkedAt: new Date().toISOString(), reason: 'token_expired' };
    }
    return { status: 'healthy', checkedAt: new Date().toISOString() };
  }

  async read(request: ConnectorRequest): Promise<ConnectorResult> {
    const credential = mustCredential(request);
    if (request.capability !== 'READ_EVENT') {
      throw new ConnectorError('INVALID_CAPABILITY', 'INVALID_REQUEST', `Unsupported capability: ${request.capability}`);
    }
    if (request.input.mode === 'provider_unavailable') {
      throw new ConnectorError('PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'Calendar provider unavailable', { retryable: true });
    }
    return { ok: true, data: { events: calendarFor(credential.calendarKey ?? credential.dataKey ?? 'primary') } };
  }
}

abstract class DisabledProviderConnector extends BaseConnector {
  protected unavailable(): never {
    throw new ConnectorError('PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'Provider adapter is not enabled yet');
  }
  async read(): Promise<ConnectorResult> { return this.unavailable(); }
  async execute(): Promise<ConnectorResult> { return this.unavailable(); }
}

export class FileProviderConnector extends BaseConnector {
  metadata = () => ({
    key: 'file_provider',
    name: '文件连接器',
    description: '从用户主动选择的本地文件读取最小元数据和内容。',
    version: '0.1.0',
    providerType: 'file' as const,
    productionStatus: 'BETA' as const,
    authentication: { type: 'none' as const },
    supportsRefresh: false,
    supportsRevoke: false,
    supportsWebhook: false,
    supportsHealthCheck: true,
    sandboxSupport: 'full' as const,
    rateLimitStrategy: 'fixed_window' as const,
  });
  capabilities = (): ConnectorCapability[] => [
    { key: 'READ_FILE_METADATA', name: '读取文件元数据', userFacingName: '读取文件信息', riskLevel: 'R0', operation: 'read', requiredPermission: 'READ_FILE_METADATA', providerAvailability: 'beta' },
    { key: 'READ_FILE', name: '读取文件内容', userFacingName: '读取文件内容', riskLevel: 'R0', operation: 'read', requiredPermission: 'READ_FILE', providerAvailability: 'beta' },
  ];

  async read(request: ConnectorRequest): Promise<ConnectorResult> {
    const fileName = typeof request.input.fileName === 'string' ? request.input.fileName : '';
    const mimeType = typeof request.input.mimeType === 'string' ? request.input.mimeType : 'application/octet-stream';
    const contentBase64 = typeof request.input.contentBase64 === 'string' ? request.input.contentBase64 : '';
    if (!fileName || !contentBase64) throw new ConnectorError('INVALID_FILE', 'INVALID_REQUEST', 'Selected file metadata or content is missing');
    const content = Buffer.from(contentBase64, 'base64');
    if (content.length === 0 || content.length > 1_000_000) throw new ConnectorError('INVALID_FILE', 'INVALID_REQUEST', 'Selected file must be between 1 byte and 1 MB');
    const metadata = { fileName, mimeType, sizeBytes: content.length, contentSha256: createHash('sha256').update(content).digest('hex') };
    if (request.capability === 'READ_FILE_METADATA') return { ok: true, data: metadata };
    if (request.capability === 'READ_FILE') return { ok: true, data: { ...metadata, contentBase64 } };
    throw new ConnectorError('INVALID_CAPABILITY', 'INVALID_REQUEST', `Unsupported capability: ${request.capability}`);
  }
}

export class LogisticsProviderConnector extends BaseConnector {
  metadata = () => ({
    key: 'logistics_provider',
    name: '物流连接器',
    description: '统一快递状态读取能力矩阵。',
    version: '0.1.0',
    providerType: 'logistics' as const,
    productionStatus: 'DRAFT_ONLY' as const,
    authentication: { type: 'api_key' as const },
    supportsRefresh: false,
    supportsRevoke: true,
    supportsWebhook: true,
    supportsHealthCheck: true,
    sandboxSupport: 'limited' as const,
    rateLimitStrategy: 'unknown' as const,
  });
  capabilities = (): ConnectorCapability[] => [
    { key: 'READ_TRACKING', name: '读取物流轨迹', userFacingName: '读取物流状态', riskLevel: 'R0', operation: 'read', requiredPermission: 'READ_TRACKING', providerAvailability: 'draft_only' },
  ];

  async read(request: ConnectorRequest): Promise<ConnectorResult> {
    if (request.capability !== 'READ_TRACKING') throw new ConnectorError('INVALID_CAPABILITY', 'INVALID_REQUEST', `Unsupported capability: ${request.capability}`);
    if (request.input.testMode !== true) throw new ConnectorError('PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'A production logistics provider is not enabled');
    const provider = typeof request.input.provider === 'string' ? request.input.provider : 'test';
    const payload = request.input.payload && typeof request.input.payload === 'object' && !Array.isArray(request.input.payload)
      ? request.input.payload as Record<string, unknown>
      : {};
    const normalized = normalizeLogisticsFixture(provider, payload);
    return { ok: true, data: normalized };
  }
}

function normalizeLogisticsFixture(provider: string, payload: Record<string, unknown>) {
  if (provider === 'sf_test') {
    const state = logisticsState(String(payload.opCode ?? ''));
    return {
      trackingNumber: String(payload.waybillNo ?? ''), carrier: 'SF', state,
      latestEvent: String(payload.opDesc ?? ''), lastUpdatedAt: String(payload.opTime ?? ''),
      deliveredAt: state === 'delivered' ? String(payload.opTime ?? '') : null,
    };
  }
  if (provider === 'jd_test') {
    const state = logisticsState(String(payload.statusCode ?? ''));
    return {
      trackingNumber: String(payload.orderCode ?? ''), carrier: 'JD', state,
      latestEvent: String(payload.statusText ?? ''), lastUpdatedAt: String(payload.statusTime ?? ''),
      deliveredAt: state === 'delivered' ? String(payload.statusTime ?? '') : null,
    };
  }
  throw new ConnectorError('INVALID_PROVIDER_FIXTURE', 'INVALID_REQUEST', 'Unsupported logistics test provider');
}

function logisticsState(code: string) {
  const normalized = code.toLowerCase();
  if (['80', 'delivered', 'signed'].includes(normalized)) return 'delivered';
  if (['exception', 'failed', '120'].includes(normalized)) return 'exception';
  if (['created', '10'].includes(normalized)) return 'created';
  return 'in_transit';
}

export class ContentProviderConnector extends OAuthConnectorBase {
  metadata = () => ({
    key: 'content_provider',
    name: '内容平台连接器',
    description: '统一内容读取、草稿、发布能力矩阵。',
    version: '0.1.0',
    providerType: 'content' as const,
    productionStatus: 'DRAFT_ONLY' as const,
    authentication: { type: 'oauth2' as const, oauth2: { authorizationCapability: 'AUTHORIZE_CONTENT_PROVIDER', supportsRefresh: true, supportsRevoke: true, supportsPKCE: true, requiresRedirect: true } },
    supportsRefresh: true,
    supportsRevoke: true,
    supportsWebhook: false,
    supportsHealthCheck: true,
    sandboxSupport: 'limited' as const,
    rateLimitStrategy: 'unknown' as const,
  });
  capabilities = (): ConnectorCapability[] => [
    { key: 'READ_CONTENT', name: '读取内容', userFacingName: '读取内容', riskLevel: 'R0', operation: 'read', requiredPermission: 'READ_CONTENT', providerAvailability: 'draft_only' },
    { key: 'CREATE_DRAFT', name: '创建内容草稿', userFacingName: '准备发布草稿', riskLevel: 'R2', operation: 'execute', requiredPermission: 'CREATE_DRAFT', providerAvailability: 'draft_only', sideEffectContract: { sideEffect: true, retrySafety: 'ambiguous' } },
    { key: 'PUBLISH_CONTENT', name: '发布内容', userFacingName: '发布内容', riskLevel: 'R3', operation: 'execute', requiredPermission: 'PUBLISH_CONTENT', providerAvailability: 'disabled', sideEffectContract: { sideEffect: true, supportsIdempotencyKey: true, supportsOperationLookup: true, retrySafety: 'ambiguous' } },
  ];

  protected providerKey() { return 'content_provider'; }
  protected externalAccountPrefix() { return 'content-test'; }

  async completeAuthorization(request: AuthorizationCallbackRequest): Promise<AuthorizationCallbackResult> {
    return {
      ...this.buildCredential(request.code, { contentKey: 'test' }),
      grantedCapabilities: ['READ_CONTENT', 'CREATE_DRAFT'],
    };
  }

  async read(request: ConnectorRequest): Promise<ConnectorResult> {
    mustCredential(request);
    if (request.capability !== 'READ_CONTENT') throw new ConnectorError('INVALID_CAPABILITY', 'INVALID_REQUEST', `Unsupported capability: ${request.capability}`);
    const items = Array.isArray(request.input.items) ? request.input.items : [];
    return { ok: true, data: { items: items.flatMap((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      return [{
        contentId: typeof row.contentId === 'string' ? row.contentId : `test-content-${index + 1}`,
        title: typeof row.title === 'string' ? row.title : '未命名内容',
        body: typeof row.body === 'string' ? row.body : '',
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date(0).toISOString(),
      }];
    }) } };
  }

  async execute(request: ConnectorRequest): Promise<ConnectorResult> {
    mustCredential(request);
    if (request.capability !== 'CREATE_DRAFT') throw new ConnectorError('PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'Production publishing remains disabled');
    return { ok: true, data: {
      draftId: `content-draft-${request.requestId}`,
      title: typeof request.input.title === 'string' ? request.input.title : '未命名内容草稿',
      status: 'draft', published: false,
    } };
  }
}
