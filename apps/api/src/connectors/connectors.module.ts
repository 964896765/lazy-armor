import { Module } from '@nestjs/common';
import { ConnectorRegistry } from '@lazy-armor/connector-sdk';
import { DatabaseModule } from '../common/database.module';
import {
  ContentProviderConnector,
  FileProviderConnector,
  GmailConnector,
  GoogleCalendarConnector,
  InternalConnector,
  LogisticsProviderConnector,
  ManualConnector,
  TrueProcessHarnessConnector,
  trueProcessHarnessEnabled,
  WebhookConnector,
} from './base-connectors';
import { ConnectorCatalogSyncService } from './connector-catalog-sync.service';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';
import { resolveGmailOAuthConfig, resolveGoogleCalendarOAuthConfig, resolveGitHubOAuthConfig, resolveNotionOAuthConfig, resolveFeishuAppConfig, resolveDingTalkAppConfig, resolveWeComAppConfig } from '@lazy-armor/config';
import { DisabledGitHubConnector } from '../providers/github/disabled-github.connector';
import { DisabledGmailConnector } from '../providers/gmail/disabled-gmail.connector';
import { DisabledGoogleCalendarConnector } from '../providers/calendar/disabled-calendar.connector';
import { DisabledNotionConnector } from '../providers/notion/disabled-notion.connector';
import { DisabledFeishuConnector } from '../providers/feishu/disabled-feishu.connector';
import { DisabledDingTalkConnector } from '../providers/dingtalk/disabled-dingtalk.connector';
import { DisabledWeComConnector } from '../providers/wecom/disabled-wecom.connector';

export const CONNECTOR_REGISTRY = 'CONNECTOR_REGISTRY';

export function shouldRegisterTrueProcessHarnessConnector(env: NodeJS.ProcessEnv) {
  return trueProcessHarnessEnabled(env);
}

export function createConnectorRegistry(env: NodeJS.ProcessEnv = process.env) {
  const registry = new ConnectorRegistry();
  registry.register(new ManualConnector());
  registry.register(new InternalConnector());
  registry.register(new WebhookConnector());
  const gmail = resolveGmailOAuthConfig({ GMAIL_OAUTH_CLIENT_ID: env.GMAIL_OAUTH_CLIENT_ID,
    GMAIL_OAUTH_CLIENT_SECRET: env.GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REDIRECT_URI: env.GMAIL_OAUTH_REDIRECT_URI });
  if (!gmail) registry.register(env.NODE_ENV === 'test' ? new GmailConnector() : new DisabledGmailConnector());
  const calendar = resolveGoogleCalendarOAuthConfig({ GMAIL_OAUTH_CLIENT_ID: env.GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET: env.GMAIL_OAUTH_CLIENT_SECRET,
    GMAIL_OAUTH_REDIRECT_URI: env.GMAIL_OAUTH_REDIRECT_URI, GOOGLE_CALENDAR_OAUTH_REDIRECT_URI: env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI });
  if (!calendar) registry.register(env.NODE_ENV === 'test' ? new GoogleCalendarConnector() : new DisabledGoogleCalendarConnector());
  const github = resolveGitHubOAuthConfig({ GITHUB_OAUTH_CLIENT_ID: env.GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET: env.GITHUB_OAUTH_CLIENT_SECRET,
    GITHUB_OAUTH_REDIRECT_URI: env.GITHUB_OAUTH_REDIRECT_URI });
  if (!github && env.NODE_ENV !== 'test') registry.register(new DisabledGitHubConnector());
  const notion = resolveNotionOAuthConfig({ NOTION_OAUTH_CLIENT_ID: env.NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET: env.NOTION_OAUTH_CLIENT_SECRET, NOTION_OAUTH_REDIRECT_URI: env.NOTION_OAUTH_REDIRECT_URI });
  if (!notion && env.NODE_ENV !== 'test') registry.register(new DisabledNotionConnector());
  const feishu = resolveFeishuAppConfig({ FEISHU_APP_ID: env.FEISHU_APP_ID, FEISHU_APP_SECRET: env.FEISHU_APP_SECRET, FEISHU_OAUTH_REDIRECT_URI: env.FEISHU_OAUTH_REDIRECT_URI });
  if (!feishu && env.NODE_ENV !== 'test') registry.register(new DisabledFeishuConnector());
  const dingtalk = resolveDingTalkAppConfig({ DINGTALK_APP_KEY: env.DINGTALK_APP_KEY, DINGTALK_APP_SECRET: env.DINGTALK_APP_SECRET, DINGTALK_OAUTH_REDIRECT_URI: env.DINGTALK_OAUTH_REDIRECT_URI });
  if (!dingtalk && env.NODE_ENV !== 'test') registry.register(new DisabledDingTalkConnector());
  const wecom = resolveWeComAppConfig({ WECOM_CORP_ID: env.WECOM_CORP_ID, WECOM_AGENT_ID: env.WECOM_AGENT_ID, WECOM_APP_SECRET: env.WECOM_APP_SECRET, WECOM_OAUTH_REDIRECT_URI: env.WECOM_OAUTH_REDIRECT_URI, WECOM_CALLBACK_TOKEN: env.WECOM_CALLBACK_TOKEN });
  if (!wecom && env.NODE_ENV !== 'test') registry.register(new DisabledWeComConnector());
  registry.register(new FileProviderConnector());
  registry.register(new LogisticsProviderConnector());
  registry.register(new ContentProviderConnector());
  if (shouldRegisterTrueProcessHarnessConnector(env)) {
    registry.register(new TrueProcessHarnessConnector());
  }
  return registry;
}

@Module({
  imports: [DatabaseModule],
  controllers: [ConnectorsController],
  providers: [
    {
      provide: ConnectorRegistry,
      useFactory: () => createConnectorRegistry(process.env),
    },
    { provide: CONNECTOR_REGISTRY, useExisting: ConnectorRegistry },
    ConnectorCatalogSyncService,
    ConnectorsService,
  ],
  exports: [ConnectorRegistry, CONNECTOR_REGISTRY, ConnectorsService, ConnectorCatalogSyncService],
})
export class ConnectorsModule {}
