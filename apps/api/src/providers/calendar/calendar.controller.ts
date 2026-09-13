import { Body, Controller, ForbiddenException, Get, Header, Param, Post, Query, Req } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, IsISO8601 } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, Public, type AuthenticatedUser } from '../../common/auth-context';
import { GoogleCalendarService } from './calendar.service';
export class CalendarObservationDto {
  @IsOptional() @IsString() @MaxLength(1024) eventId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxItems?: number;
  @IsOptional() @IsISO8601({ strict: true }) timeMin?: string;
  @IsOptional() @IsISO8601({ strict: true }) timeMax?: string;
  @IsOptional() @IsString() @MaxLength(500) pageToken?: string;
}
@Controller('providers')
export class GoogleCalendarController {
  constructor(private readonly calendar: GoogleCalendarService) {}
  @Get('google-calendar/status') status() { return this.calendar.status(); }
  @Post('google/calendar/authorize') start(@CurrentUser() user: AuthenticatedUser) { return this.calendar.start(user.id); }
  @Public() @Get('google/oauth/calendar/callback') @Header('Cache-Control', 'no-store') @Header('Referrer-Policy', 'no-referrer')
  callback(@Req() req: Request, @Query() query: Record<string, unknown>) {
    if (!req.secure || Object.keys(query).some((key) => !['state', 'code', 'error', 'scope', 'authuser', 'prompt'].includes(key))
      || typeof query.state !== 'string' || (query.code !== undefined && typeof query.code !== 'string')
      || (query.error !== undefined && typeof query.error !== 'string')) throw new ForbiddenException('HTTPS OAuth callback required');
    return this.calendar.callback(query.state, query.code as string | undefined, query.error as string | undefined);
  }
  @Post('google-calendar/connections/:id/observations') observe(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: CalendarObservationDto) {
    return this.calendar.observe(user.id, id, body);
  }
}
