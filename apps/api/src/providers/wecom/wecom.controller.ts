import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, Public, type AuthenticatedUser } from '../../common/auth-context';
import { WeComService } from './wecom.service';
import { WeComWebhookService } from './wecom-webhook.service';
import { WECOM_SOURCE_CAPABILITIES } from './wecom-manifest';

export class WeComObservationDto {
  @IsIn(WECOM_SOURCE_CAPABILITIES as unknown as string[]) capability!: string;
  @IsOptional() @IsString() eventId?: string;
  @IsOptional() @IsString() calendarId?: string;
  @IsOptional() @IsString() spNo?: string;
  @IsOptional() @IsString() msgId?: string;
}

@Controller('providers/wecom')
export class WeComController {
  constructor(private readonly wecom: WeComService, private readonly webhooks: WeComWebhookService) {}
  @Get('status') status() { return { ...this.wecom.status(), webhookConfigured: this.webhooks.configured() }; }
  @Public() @Get('connections/:id/webhook') @HttpCode(200) @Header('Cache-Control', 'no-store')
  challenge(@Req() req: Request, @Query() query: Record<string, unknown>) {
    if (!req.secure || typeof query.echostr !== 'string') throw new ForbiddenException('HTTPS WeCom challenge required');
    return this.webhooks.challenge({ signature: query.msg_signature, timestamp: query.timestamp, nonce: query.nonce, echostr: query.echostr });
  }
  @Public() @Post('connections/:id/webhook') @HttpCode(200) @Header('Cache-Control', 'no-store')
  webhook(@Req() req: Request & { rawBody?: Buffer }, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    if (!req.secure || !req.is('application/json')) throw new ForbiddenException('HTTPS JSON webhook required');
    return this.webhooks.receive(id, { rawBody: req.rawBody, signature: query.msg_signature, timestamp: query.timestamp, nonce: query.nonce });
  }
  @Post('authorize') start(@CurrentUser() user: AuthenticatedUser) { return this.wecom.start(user.id); }
  @Public() @Get('oauth/callback') @Header('Cache-Control', 'no-store') @Header('Referrer-Policy', 'no-referrer')
  callback(@Req() req: Request, @Query() query: Record<string, unknown>) {
    if (!req.secure || Object.keys(query).some((key) => !['state', 'code', 'error', 'error_description'].includes(key))
      || typeof query.state !== 'string' || (query.code !== undefined && typeof query.code !== 'string')
      || (query.error !== undefined && typeof query.error !== 'string')) throw new ForbiddenException('HTTPS OAuth callback required');
    return this.wecom.callback(query.state, query.code as string | undefined, query.error as string | undefined);
  }
  @Post('connections/:id/observations') observe(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: WeComObservationDto) { return this.wecom.observe(user.id, id, { ...body }); }
}
