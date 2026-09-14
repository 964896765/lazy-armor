import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { IsInt, IsIn, IsObject, IsOptional, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, Public, type AuthenticatedUser } from '../../common/auth-context';
import { GitHubService } from './github.service';
import type { GitHubRepository } from './github-resource';
import { GitHubWebhookService } from './github-webhook.service';
export class GitHubObservationDto {
  @IsIn(['READ_ISSUE', 'READ_PULL_REQUEST', 'READ_WORKFLOW_STATUS']) capability!: string;
  @IsObject() repository!: GitHubRepository;
  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) number?: number;
  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) runId?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxItems?: number;
}
@Controller('providers/github')
export class GitHubController {
  constructor(private readonly github: GitHubService, private readonly webhooks: GitHubWebhookService) {}
  @Get('status') status() { return { ...this.github.status(), webhookConfigured: this.webhooks.configured() }; }
  @Public() @Post('connections/:id/webhook') @HttpCode(202) @Header('Cache-Control', 'no-store')
  webhook(@Req() req: Request & { rawBody?: Buffer }, @Param('id', new ParseUUIDPipe()) id: string) {
    if (!req.secure || !req.is('application/json') || req.query && Object.keys(req.query).length) throw new ForbiddenException('HTTPS JSON webhook required');
    return this.webhooks.receive(id, { rawBody: req.rawBody, signature: req.headers['x-hub-signature-256'],
      deliveryId: req.headers['x-github-delivery'], event: req.headers['x-github-event'] });
  }
  @Get('webhook-receipts/:id') receipt(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.webhooks.get(user.id, id); }
  @Post('authorize') start(@CurrentUser() user: AuthenticatedUser) { return this.github.start(user.id); }
  @Public() @Get('oauth/callback') @Header('Cache-Control', 'no-store') @Header('Referrer-Policy', 'no-referrer')
  callback(@Req() req: Request, @Query() query: Record<string, unknown>) {
    if (!req.secure || Object.keys(query).some((key) => !['state', 'code', 'error', 'error_description', 'error_uri'].includes(key))
      || typeof query.state !== 'string' || (query.code !== undefined && typeof query.code !== 'string')
      || (query.error !== undefined && typeof query.error !== 'string')) throw new ForbiddenException('HTTPS OAuth callback required');
    return this.github.callback(query.state, query.code as string | undefined, query.error as string | undefined);
  }
  @Post('connections/:id/observations') observe(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: GitHubObservationDto) { return this.github.observe(user.id, id, body); }
}
