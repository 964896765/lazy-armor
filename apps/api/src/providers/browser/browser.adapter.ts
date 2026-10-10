import { ProviderRuntimeError, type ConnectorRequest, type ProviderAdapter, type VerificationRequest } from '@lazy-armor/connector-sdk';
import { evaluateVerification } from '@lazy-armor/plan-schema';
import { BrowserDriver } from './browser-driver';
import { browserManifest } from './browser-manifest';
export class BrowserAdapter implements ProviderAdapter {
  constructor(private readonly driver: BrowserDriver, private readonly assertCurrent: (request: ConnectorRequest) => Promise<void>) {}
  metadata = () => ({ key: 'controlled_browser', name: '受控网页', description: '指定来源的网页读取与确认表单；使用独立浏览器会话', version: '1.0.0', connectorSdkVersion: '0.1.0',
    providerType: 'content' as const, productionStatus: 'BETA' as const, authentication: { type: 'none' as const }, supportsRefresh: false, supportsRevoke: true,
    supportsWebhook: false, supportsHealthCheck: true, sandboxSupport: 'limited' as const, rateLimitStrategy: 'fixed_window' as const });
  capabilities = () => structuredClone(browserManifest.capabilities);
  async authorize(): Promise<never> { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
  async refresh(): Promise<never> { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
  async revoke() {}
  async health(input?: ConnectorRequest) { const checkedAt = await this.driver.health(this.endpoint(input));
    return { status: 'healthy' as const, checkedAt, validUntil: new Date(Date.now() + 300000).toISOString() }; }
  async read(input: ConnectorRequest) {
    if (input.capability !== 'BROWSER_OBSERVE') throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    return { ok: true, data: await this.driver.read(input.input, this.endpoint(input)) };
  }
  execute(input: ConnectorRequest) { return this.action(input, false); }
  lookupOperation(input: ConnectorRequest) { return this.action(input, true); }
  async verify(input: VerificationRequest) { return { state: evaluateVerification(input.policy, 'PROVIDER_RESPONSE', input.result.data),
    method: 'PROVIDER_RESPONSE' as const, evidence: input.result.data }; }
  private async action(input: ConnectorRequest, lookup: boolean) {
    if (input.capability !== 'BROWSER_SUBMIT_FORM' || !input.idempotencyKey) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const config = input.input.config as Record<string, unknown> | undefined;
    return { ok: true, data: await this.driver.form(config?.browser, this.endpoint(input), input.idempotencyKey, () => this.assertCurrent(input), lookup) };
  }
  private endpoint(input?: ConnectorRequest) {
    const endpoint = input?.credentials?.data?.endpoint;
    if (!endpoint) throw new ProviderRuntimeError('AUTH_REVOKED', 'BEFORE_DISPATCH'); return endpoint;
  }
}
