import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CreatePlanOfferDto } from './dto';
import { PlanningOffersService } from './planning-offers.service';

@Controller('planning/offers')
export class PlanningOffersController {
  constructor(private readonly offers: PlanningOffersService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() request: CreatePlanOfferDto) {
    return this.offers.create(user.id, request);
  }
}
