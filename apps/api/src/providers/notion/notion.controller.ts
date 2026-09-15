import { Body, Controller, ForbiddenException, Get, Header, Param, Post, Query, Req } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { Request } from 'express'; import { CurrentUser, Public, type AuthenticatedUser } from '../../common/auth-context'; import { NotionService } from './notion.service';
export class NotionObservationDto { @IsIn(['READ_PAGE', 'READ_DATA_SOURCE']) capability!: 'READ_PAGE' | 'READ_DATA_SOURCE'; @IsUUID() resourceId!: string; @IsOptional() @IsBoolean() includeRows?: boolean; @IsOptional() @IsInt() @Min(1) @Max(100) maxItems?: number; }
@Controller('providers/notion') export class NotionController {
  constructor(private readonly notion: NotionService) {} @Get('status') status() { return this.notion.status(); }
  @Post('authorize') start(@CurrentUser() user: AuthenticatedUser) { return this.notion.start(user.id); }
  @Public() @Get('oauth/callback') @Header('Cache-Control', 'no-store') @Header('Referrer-Policy', 'no-referrer') callback(@Req() req: Request, @Query() query: Record<string, unknown>) {
    if (!req.secure || Object.keys(query).some((key) => !['state', 'code', 'error', 'error_description'].includes(key)) || typeof query.state !== 'string'
      || (query.code !== undefined && typeof query.code !== 'string') || (query.error !== undefined && typeof query.error !== 'string')) throw new ForbiddenException('HTTPS OAuth callback required');
    return this.notion.callback(query.state, query.code as string | undefined, query.error as string | undefined); }
  @Post('connections/:id/observations') observe(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: NotionObservationDto) { return this.notion.observe(user.id, id, body); }
}
