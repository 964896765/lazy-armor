import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { TrustedDevicesService, type TrustedDeviceRequestEnvelope } from '../trusted-devices/trusted-devices.service';
import { CompleteDeviceTaskDto, FailDeviceTaskDto, HeartbeatDeviceDto, HeartbeatTaskDto } from './dto';
import { DeviceTasksService } from './device-tasks.service';

@Controller('device-tasks')
export class DeviceTasksController {
  constructor(private readonly deviceTasks: DeviceTasksService, private readonly trustedDevices: TrustedDevicesService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Headers() headers: IncomingHttpHeaders) {
    await this.trustedDevices.assertSignedRequest(user.id, deviceEnvelope(headers), 'GET', '/device-tasks', {});
    return this.deviceTasks.list(user.id);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Headers() headers: IncomingHttpHeaders) {
    const requestPath = `/device-tasks/${id}`;
    await this.trustedDevices.assertSignedRequest(user.id, deviceEnvelope(headers), 'GET', requestPath, {});
    return this.deviceTasks.get(user.id, id);
  }

  @Post('heartbeat')
  async heartbeatDevice(@CurrentUser() user: AuthenticatedUser, @Body() input: HeartbeatDeviceDto, @Headers() headers: IncomingHttpHeaders) {
    const signed = await this.trustedDevices.assertSignedRequest(user.id, deviceEnvelope(headers), 'POST', '/device-tasks/heartbeat', input);
    return this.deviceTasks.heartbeatDevice(user.id, signed.trustedDeviceId, signed.deviceId, input.onlineState);
  }

  @Post(':id/claim')
  async claim(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Headers() headers: IncomingHttpHeaders) {
    const requestPath = `/device-tasks/${id}/claim`;
    const signed = await this.trustedDevices.assertSignedRequest(user.id, deviceEnvelope(headers), 'POST', requestPath, {});
    return this.deviceTasks.claim(user.id, signed.deviceId, id);
  }

  @Post(':id/heartbeat')
  async heartbeat(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: HeartbeatTaskDto, @Headers() headers: IncomingHttpHeaders) {
    const requestPath = `/device-tasks/${id}/heartbeat`;
    await this.trustedDevices.assertSignedRequest(user.id, deviceEnvelope(headers), 'POST', requestPath, input);
    return this.deviceTasks.heartbeat(user.id, id, input.claimToken);
  }

  @Post(':id/complete')
  async complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: CompleteDeviceTaskDto, @Headers() headers: IncomingHttpHeaders) {
    const requestPath = `/device-tasks/${id}/complete`;
    await this.trustedDevices.assertSignedRequest(user.id, deviceEnvelope(headers), 'POST', requestPath, input);
    return this.deviceTasks.complete(user.id, id, input.claimToken, input.result);
  }

  @Post(':id/fail')
  async fail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: FailDeviceTaskDto, @Headers() headers: IncomingHttpHeaders) {
    const requestPath = `/device-tasks/${id}/fail`;
    await this.trustedDevices.assertSignedRequest(user.id, deviceEnvelope(headers), 'POST', requestPath, input);
    return this.deviceTasks.fail(user.id, id, input.claimToken, input.errorCode);
  }
}

function deviceEnvelope(headers: IncomingHttpHeaders): TrustedDeviceRequestEnvelope {
  return {
    sessionId: header(headers, 'x-device-session'),
    requestId: header(headers, 'x-device-request-id'),
    signedAt: header(headers, 'x-device-signed-at'),
    payloadHash: header(headers, 'x-device-payload-hash'),
    signature: header(headers, 'x-device-signature'),
  };
}

function header(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}
