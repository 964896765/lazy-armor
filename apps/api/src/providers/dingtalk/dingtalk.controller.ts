import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, Public, type AuthenticatedUser } from '../../common/auth-context';
import { DingTalkService } from './dingtalk.service';
import { DingTalkWebhookService } from './dingtalk-webhook.service';
import { DINGTALK_SOURCE_CAPABILITIES } from './dingtalk-manifest';

export class DingTalkObservationDto {
  @IsIn(DINGTALK_SOURCE_CAPABILITIES as unknown as string[]) capability!: string;
  @IsOptional() @IsString() eventId?: string;
  @IsOptional() @IsString() calendarId?: string;
  @IsOptional() @IsString() messageId?: string;
  @IsOptional() @IsString() instanceId?: string;
}

@Controller('providers/dingtalk')
export class DingTalkController {
  constructor(private readonly dingtalk: DingTalkService, private readonly webhooks: DingTalkWebhookService) {}
  @Get('status') status() { return { ...this.dingtalk.status(), webhookConfigured: this.webhooks.configured() }; }
  @Public() @Post('connections/:id/webhook') @HttpCode(200) @Header('Cache-Control', 'no-store')
  webhook(@Req() req: Request & { rawBody?: Buffer }, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    if (!req.secure || !req.is('application/json')) throw new ForbiddenException('HTTPS JSON webhook required');
    const signature = req.headers['x-acs-dingtalk-signature'] ?? query.signature;
    const timestamp = req.headers['x-acs-dingtalk-timestamp'] ?? query.timestamp;
    return this.webhooks.receive(id, { rawBody: req.rawBody, signature, timestamp });
  }
  @Post('authorize') start(@CurrentUser() user: AuthenticatedUser) { return this.dingtalk.start(user.id); }
  @Public() @Get('oauth/callback') @Header('Cache-Control', 'no-store') @Header('Referrer-Policy', 'no-referrer')
  callback(@Req() req: Request, @Query() query: Record<string, unknown>) {
    const allowed = ['state', 'code', 'authCode', 'error', 'error_description'];
    if (!req.secure || Object.keys(query).some((key) => !allowed.includes(key))
      || typeof query.state !== 'string' || (query.code !== undefined && typeof query.code !== 'string')
      || (query.authCode !== undefined && typeof query.authCode !== 'string')
      || (query.error !== undefined && typeof query.error !== 'string')) throw new ForbiddenException('HTTPS OAuth callback required');
    const code = (query.code ?? query.authCode) as string | undefined;
    return this.dingtalk.callback(query.state, code, query.error as string | undefined);
  }
  @Post('connections/:id/observations') observe(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: DingTalkObservationDto) { return this.dingtalk.observe(user.id, id, { ...body }); }
}
