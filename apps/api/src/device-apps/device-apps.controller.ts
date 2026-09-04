import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CreateDeviceAppConnectionDto, UpdateDeviceAppConnectionDto } from './dto';
import { DeviceAppsService } from './device-apps.service';
import { MobileNotificationReceiptsService } from './mobile-notification-receipts.service';
import { CreateMobileNotificationReceiptDto } from './notification-receipt.dto';

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

  @Post(':id/notification-receipts')
  receiveNotificationReceipt(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: CreateMobileNotificationReceiptDto) {
    return this.notificationReceipts.receive(user.id, id, input);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: UpdateDeviceAppConnectionDto) {
    return this.deviceApps.update(user.id, id, input);
  }
}
