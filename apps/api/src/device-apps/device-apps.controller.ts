import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CreateDeviceAppConnectionDto, UpdateDeviceAppConnectionDto } from './dto';
import { DeviceAppsService } from './device-apps.service';
import { MobileNotificationReceiptsService } from './mobile-notification-receipts.service';
import { CreateMobileNotificationReceiptDto } from './notification-receipt.dto';
import { VerifyMobileNotificationReceiptDto } from './verify-notification-receipt.dto';

@Controller('device-app-connections')
export class DeviceAppsController {
  constructor(private readonly deviceApps: DeviceAppsService, private readonly notificationReceipts: MobileNotificationReceiptsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.deviceApps.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateDeviceAppConnectionDto) {
    return this.deviceApps.create(user.id, input);
  }

  @Get('notification-receipts')
  listPendingNotificationReceipts(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationReceipts.listPending(user.id);
  }

  @Post(':id/notification-receipts')
  receiveNotificationReceipt(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: CreateMobileNotificationReceiptDto) {
    return this.notificationReceipts.receive(user.id, id, input);
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
