import { Controller, Get, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { ConnectorsModule } from '../../connectors/connectors.module';
import { ConnectorCatalogSyncService } from '../../connectors/connector-catalog-sync.service';
import { ProviderRuntimeModule } from '../../provider-runtime/provider-runtime.module';
import { ProviderRuntimeService } from '../../provider-runtime/provider-runtime.service';
import { BrowserDriver } from './browser-driver';
import { BrowserAdapter } from './browser.adapter';
import { browserEvidence, browserManifest, browserPolicy } from './browser-manifest';

@Injectable()
class BrowserService implements OnModuleInit {
  private configured = false;
  constructor(private readonly config: ConfigService, private readonly registry: ConnectorRegistry,
    private readonly runtime: ProviderRuntimeService, private readonly catalog: ConnectorCatalogSyncService) {}
  async onModuleInit() {
    if (this.config.get('BROWSER_RUNTIME_ENABLED') !== '1') return;
    const executablePath = this.config.get<string>('BROWSER_EXECUTABLE_PATH');
    const allowedOrigins = (this.config.get<string>('BROWSER_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean);
    if (!executablePath || !allowedOrigins.length || allowedOrigins.some(value => { try { const url = new URL(value); return url.protocol !== 'https:' || url.origin !== value; } catch { return true; } }))
      throw new Error('Browser runtime requires an executable and exact HTTPS origins');
    const adapter = new BrowserAdapter(new BrowserDriver({ executablePath, allowedOrigins }), request => this.runtime.beforeOperation(browserPolicy, request, 'execute'));
    await this.runtime.publish({ manifest: browserManifest, evidence: browserEvidence, policy: browserPolicy });
    this.registry.register(this.runtime.bridge(adapter, browserManifest, browserPolicy)); await this.catalog.sync(); this.configured = true;
  }
  status() { return { configured: this.configured, implementation: this.configured ? 'BETA' : 'DISABLED',
    capabilities: ['BROWSER_OBSERVE', 'BROWSER_SUBMIT_FORM'], requiresPermission: true, requiresExecutionApproval: true, realWebsiteAcceptance: 'NOT_VERIFIED' }; }
}
@Controller('browser')
class BrowserController {
  constructor(private readonly browser: BrowserService) {}
  @Get('status') status() { return this.browser.status(); }
}
@Module({ imports: [ConnectorsModule, ProviderRuntimeModule], controllers: [BrowserController], providers: [BrowserService] })
export class BrowserModule {}
