import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CompleteRecurringItemProfileDto, CreateDigitalAccountProfileDto, CreateRecurringItemProfileDto, CreateVehicleProfileDto, UpdateVehicleMileageDto } from './dto';
import { ProfilesService } from './profiles.service';

@Controller()
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Post('vehicle-profiles') createVehicle(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateVehicleProfileDto) { return this.profiles.createVehicle(user.id, input); }
  @Get('vehicle-profiles') listVehicles(@CurrentUser() user: AuthenticatedUser) { return this.profiles.listVehicles(user.id); }
  @Patch('vehicle-profiles/:id/mileage') updateMileage(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: UpdateVehicleMileageDto) { return this.profiles.updateMileage(user.id, id, input); }

  @Post('digital-account-profiles') createDigitalAccount(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateDigitalAccountProfileDto) { return this.profiles.createDigitalAccount(user.id, input); }
  @Get('digital-account-profiles') listDigitalAccounts(@CurrentUser() user: AuthenticatedUser) { return this.profiles.listDigitalAccounts(user.id); }

  @Post('recurring-item-profiles') createRecurringItem(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateRecurringItemProfileDto) { return this.profiles.createRecurringItem(user.id, input); }
  @Get('recurring-item-profiles') listRecurringItems(@CurrentUser() user: AuthenticatedUser) { return this.profiles.listRecurringItems(user.id); }
  @Post('recurring-item-profiles/:id/complete') completeRecurringItem(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: CompleteRecurringItemProfileDto) { return this.profiles.completeRecurringItem(user.id, id, input); }
}
