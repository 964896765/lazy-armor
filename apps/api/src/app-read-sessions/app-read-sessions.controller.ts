import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { TrustedDevicesService, type TrustedDeviceRequestEnvelope } from '../trusted-devices/trusted-devices.service';
import { AppReadSessionsService } from './app-read-sessions.service';
import { AppReadHeartbeatDto, CreateAppReadSessionDto, CreateAppReadSessionEventDto } from './dto';

@Controller('app-read-sessions')
export class AppReadSessionsController {
  constructor(private readonly sessions: AppReadSessionsService, private readonly trustedDevices: TrustedDevicesService) {}

  @Get('current') current(@CurrentUser() user: AuthenticatedUser) { return this.sessions.current(user.id); }
  @Get(':id') get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.sessions.get(user.id, id); }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateAppReadSessionDto, @Headers() headers: IncomingHttpHeaders) {
    const signed = await this.trustedDevices.assertSignedRequest(user.id, envelope(headers), 'POST', '/app-read-sessions', input);
    return this.sessions.create(user.id, input, signed.trustedDeviceId);
  }

  @Post(':id/heartbeat')
  async heartbeat(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: AppReadHeartbeatDto, @Headers() headers: IncomingHttpHeaders) {
    const path = '/app-read-sessions/' + id + '/heartbeat';
    const signed = await this.trustedDevices.assertSignedRequest(user.id, envelope(headers), 'POST', path, input);
    return this.sessions.heartbeat(user.id, id, input, signed.trustedDeviceId);
  }

  @Post(':id/events')
  async event(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: CreateAppReadSessionEventDto, @Headers() headers: IncomingHttpHeaders) {
    const path = '/app-read-sessions/' + id + '/events';
    const signed = await this.trustedDevices.assertSignedRequest(user.id, envelope(headers), 'POST', path, input);
    return this.sessions.recordEvent(user.id, id, input, signed.trustedDeviceId);
  }

  @Post(':id/stop')
  async stop(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Headers() headers: IncomingHttpHeaders) {
    const input = {};
    const path = '/app-read-sessions/' + id + '/stop';
    const signed = await this.trustedDevices.assertSignedRequest(user.id, envelope(headers), 'POST', path, input);
    return this.sessions.stop(user.id, id, signed.trustedDeviceId);
  }
}

function envelope(headers: IncomingHttpHeaders): TrustedDeviceRequestEnvelope {
  return {
    sessionId: header(headers, 'x-device-session'), requestId: header(headers, 'x-device-request-id'),
    signedAt: header(headers, 'x-device-signed-at'), payloadHash: header(headers, 'x-device-payload-hash'),
    signature: header(headers, 'x-device-signature'),
  };
}
function header(headers: IncomingHttpHeaders, name: string) { const value = headers[name]; return Array.isArray(value) ? value[0] ?? '' : value ?? ''; }
