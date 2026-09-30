import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ChoosePersistentPlanOfferDto, CreatePersistentPlanOfferDto, CreatePlanOfferDto } from './dto';
import { PlanningOffersService } from './planning-offers.service';

@Controller('planning/offers')
export class PlanningOffersController {
  constructor(private readonly offers: PlanningOffersService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() request: CreatePlanOfferDto) {
    return this.offers.create(user.id, request);
  }


  @Post('v2')
  createPersistent(@CurrentUser() user: AuthenticatedUser, @Body() request: CreatePersistentPlanOfferDto) {
    return this.offers.createPersistent(user.id, request);
  }

  @Get('plans/:planId/availability')
  planAvailability(@CurrentUser() user: AuthenticatedUser, @Param('planId', ParseUUIDPipe) planId: string) {
    return this.offers.planAvailability(user.id, planId);
  }

  @Post('plans/:planId/replan')
  replan(@CurrentUser() user: AuthenticatedUser, @Param('planId', ParseUUIDPipe) planId: string) {
    return this.offers.replan(user.id, planId);
  }

  @Post(':offerId/choose')
  choose(@CurrentUser() user: AuthenticatedUser, @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() request: ChoosePersistentPlanOfferDto) {
    return this.offers.choose(user.id, offerId, request);
  }
}
