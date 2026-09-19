import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, Public, type AuthenticatedUser } from '../../common/auth-context';
import { FeishuService } from './feishu.service';
import { FeishuWebhookService } from './feishu-webhook.service';
import { FEISHU_SOURCE_CAPABILITIES } from './feishu-manifest';

export class FeishuObservationDto {
  @IsIn(FEISHU_SOURCE_CAPABILITIES as unknown as string[]) capability!: string;
  @IsOptional() @IsString() eventId?: string;
  @IsOptional() @IsString() calendarId?: string;
  @IsOptional() @IsString() messageId?: string;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsString() spreadsheetToken?: string;
  @IsOptional() @IsString() range?: string;
  @IsOptional() @IsString() appToken?: string;
  @IsOptional() @IsString() tableId?: string;
  @IsOptional() @IsString() instanceCode?: string;
}

@Controller('providers/feishu')
export class FeishuController {
  constructor(private readonly feishu: FeishuService, private readonly webhooks: FeishuWebhookService) {}
  @Get('status') status() { return { ...this.feishu.status(), webhookConfigured: this.webhooks.configured() }; }
  @Public() @Post('connections/:id/webhook') @HttpCode(200) @Header('Cache-Control', 'no-store')
  webhook(@Req() req: Request & { rawBody?: Buffer }, @Param('id') id: string) {
    if (!req.secure || !req.is('application/json') || (req.query && Object.keys(req.query).length)) throw new ForbiddenException('HTTPS JSON webhook required');
    return this.webhooks.receive(id, { rawBody: req.rawBody, signature: req.headers['x-lark-signature'] });
  }
  @Post('authorize') start(@CurrentUser() user: AuthenticatedUser) { return this.feishu.start(user.id); }
  @Public() @Get('oauth/callback') @Header('Cache-Control', 'no-store') @Header('Referrer-Policy', 'no-referrer')
  callback(@Req() req: Request, @Query() query: Record<string, unknown>) {
    if (!req.secure || Object.keys(query).some((key) => !['state', 'code', 'error', 'error_description'].includes(key))
      || typeof query.state !== 'string' || (query.code !== undefined && typeof query.code !== 'string')
      || (query.error !== undefined && typeof query.error !== 'string')) throw new ForbiddenException('HTTPS OAuth callback required');
    return this.feishu.callback(query.state, query.code as string | undefined, query.error as string | undefined);
  }
  @Post('connections/:id/observations') observe(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: FeishuObservationDto) { return this.feishu.observe(user.id, id, { ...body }); }
}
