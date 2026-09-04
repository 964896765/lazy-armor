import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { TrustedDevicesService, type TrustedDeviceRequestEnvelope } from '../trusted-devices/trusted-devices.service';
import { CreateDeviceAppConnectionDto, UpdateDeviceAppConnectionDto } from './dto';
import { DeviceAppsService } from './device-apps.service';
import { MobileNotificationReceiptsService } from './mobile-notification-receipts.service';
import { CreateMobileNotificationReceiptDto } from './notification-receipt.dto';
import { VerifyMobileNotificationReceiptDto } from './verify-notification-receipt.dto';

@Controller('device-app-connections')
export class DeviceAppsController {
  constructor(
    private readonly deviceApps: DeviceAppsService,
    private readonly notificationReceipts: MobileNotificationReceiptsService,
    private readonly trustedDevices: TrustedDevicesService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) { return this.deviceApps.list(user.id); }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateDeviceAppConnectionDto, @Headers() headers: IncomingHttpHeaders) {
    const signedDevice = await this.trustedDevices.assertSignedRequest(user.id, deviceEnvelope(headers), 'POST', '/device-app-connections', input);
    return this.deviceApps.create(user.id, input, signedDevice.trustedDeviceId);
  }

  @Get('notification-receipts')
  listPendingNotificationReceipts(@CurrentUser() user: AuthenticatedUser) { return this.notificationReceipts.listPending(user.id); }

  @Post(':id/notification-receipts')
  async receiveNotificationReceipt(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: CreateMobileNotificationReceiptDto, @Headers() headers: IncomingHttpHeaders) {
    const requestPath = `/device-app-connections/${id}/notification-receipts`;
    const signedDevice = await this.trustedDevices.assertSignedRequest(user.id, deviceEnvelope(headers), 'POST', requestPath, input);
    return this.notificationReceipts.receive(user.id, id, input, signedDevice.trustedDeviceId);
  }

  @Post(':id/notification-receipts/:receiptId/verify')
  verifyNotificationReceipt(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('receiptId') receiptId: string, @Body() input: VerifyMobileNotificationReceiptDto) {
    return this.notificationReceipts.verify(user.id, id, receiptId, input);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: UpdateDeviceAppConnectionDto) {
    return this.deviceApps.update(user.id, id, input);
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
