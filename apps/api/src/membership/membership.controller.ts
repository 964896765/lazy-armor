import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { EntitlementService } from './entitlement.service';

@Controller('me/membership')
export class MembershipController {
  constructor(private readonly entitlements: EntitlementService) {}

  @Get()
  getMembership(@CurrentUser() user: AuthenticatedUser) {
    return this.entitlements.getEntitlements(user.id);
  }
}
