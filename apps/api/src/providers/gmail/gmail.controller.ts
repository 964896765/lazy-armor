import { Body, Controller, ForbiddenException, Get, Header, Param, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, Public, type AuthenticatedUser } from '../../common/auth-context';
import { GmailService } from './gmail.service';

export class GmailObservationDto {
  @IsIn(['READ_EMAIL_METADATA', 'READ_EMAIL_BODY']) capability!: string;
  @IsOptional() @IsString() @MaxLength(200) messageId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxItems?: number;
  @IsOptional() @IsString() @MaxLength(500) q?: string;
  @IsOptional() @IsString() @MaxLength(500) pageToken?: string;
}
@Controller('providers')
export class GmailController {
  constructor(private readonly gmail: GmailService) {}
  @Get('gmail/status') status() { return this.gmail.status(); }
  @Post('google/gmail/authorize') start(@CurrentUser() user: AuthenticatedUser) { return this.gmail.start(user.id); }
  @Public() @Get('google/oauth/gmail/callback') @Header('Cache-Control', 'no-store') @Header('Referrer-Policy', 'no-referrer')
  callback(@Req() req: Request, @Query() query: Record<string, unknown>) {
    // Express only honors forwarded protocol from explicitly trusted proxies.
    if (!req.secure || Object.keys(query).some((key) => !['state', 'code', 'error', 'scope', 'authuser', 'prompt'].includes(key))
      || typeof query.state !== 'string' || (query.code !== undefined && typeof query.code !== 'string')
      || (query.error !== undefined && typeof query.error !== 'string')) throw new ForbiddenException('HTTPS OAuth callback required');
    return this.gmail.callback(query.state, query.code as string | undefined, query.error as string | undefined);
  }
  @Post('gmail/connections/:id/observations') observe(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: GmailObservationDto) {
    return this.gmail.observe(user.id, id, body);
  }
}
