import { Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Public, type AuthenticatedUser } from '../common/auth-context';
import { CancelSubscriptionDto, CreateSubscriptionCheckoutDto } from './dto';
import { SubscriptionBillingService } from './subscription-billing.service';

type RequestWithRawBody = Request & { rawBody?: Buffer };

@Controller('subscription-billing')
export class SubscriptionBillingController {
  constructor(private readonly billing: SubscriptionBillingService) {}

  @Post('checkout')
  createCheckout(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateSubscriptionCheckoutDto) {
    return this.billing.createCheckout(user.id, input);
  }

  @Get('subscription')
  getSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.getCurrent(user.id);
  }

  @Post('subscription/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Body() input: CancelSubscriptionDto) {
    return this.billing.cancel(user.id, input.requestId);
  }

  @Public()
  @Post('webhooks/sandbox')
  webhook(
    @Req() request: RequestWithRawBody,
    @Headers('x-sandbox-signature') signature = '',
    @Headers('x-sandbox-timestamp') timestamp = '',
  ) {
    const rawBody = request.rawBody?.toString('utf8') ?? JSON.stringify(request.body);
    return this.billing.receiveWebhook(rawBody, signature, timestamp);
  }
}
