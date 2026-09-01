import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import {
  CreateDeviceConsumableDto,
  CreateDeviceProfileDto,
  ListDeviceConsumablesDto,
  ListDeviceProfilesDto,
  UpdateDeviceConsumableReplacementDto,
} from './dto';
import { DeviceService } from './device.service';

@Controller()
export class DeviceController {
  constructor(private readonly device: DeviceService) {}

  @Post('device-profiles')
  createProfile(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateDeviceProfileDto) {
    return this.device.createProfile(user.id, input);
  }

  @Get('device-profiles')
  listProfiles(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDeviceProfilesDto) {
    return this.device.listProfiles(user.id, query.type);
  }

  @Post('device-consumables')
  createConsumable(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateDeviceConsumableDto) {
    return this.device.createConsumable(user.id, input);
  }

  @Get('device-consumables')
  listConsumables(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDeviceConsumablesDto) {
    return this.device.listConsumables(user.id, query.deviceProfileId);
  }

  @Patch('device-consumables/:id/replacement')
  updateReplacement(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: UpdateDeviceConsumableReplacementDto) {
    return this.device.updateReplacement(user.id, id, input.lastReplacedAt);
  }
}
