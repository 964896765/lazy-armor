import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import {
  CreateHouseholdSupplyProfileDto,
  ListHouseholdSupplyProfilesDto,
  ListPreparedShoppingItemsDto,
} from './dto';
import { HouseholdService } from './household.service';

@Controller()
export class HouseholdController {
  constructor(private readonly household: HouseholdService) {}

  @Post('household-supply-profiles')
  createProfile(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateHouseholdSupplyProfileDto) {
    return this.household.createProfile(user.id, input);
  }

  @Get('household-supply-profiles')
  listProfiles(@CurrentUser() user: AuthenticatedUser, @Query() query: ListHouseholdSupplyProfilesDto) {
    return this.household.listProfiles(user.id, query.itemName);
  }

  @Get('prepared-shopping-items')
  listPreparedItems(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPreparedShoppingItemsDto) {
    return this.household.listPreparedItems(user.id, query.status);
  }
}
