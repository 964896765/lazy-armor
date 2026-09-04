import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CreateTrustedDeviceChallengeDto, VerifyTrustedDeviceChallengeDto } from './dto';
import { TrustedDevicesService } from './trusted-devices.service';

@Controller('trusted-devices')
export class TrustedDevicesController {
  constructor(private readonly trustedDevices: TrustedDevicesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) { return this.trustedDevices.list(user.id); }

  @Post('challenges')
  createChallenge(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateTrustedDeviceChallengeDto) {
    return this.trustedDevices.issueChallenge(user.id, input);
  }

  @Post('challenges/:id/verify')
  verifyChallenge(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: VerifyTrustedDeviceChallengeDto) {
    return this.trustedDevices.verifyChallenge(user.id, id, input);
  }

  @Post(':id/revoke')
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.trustedDevices.revoke(user.id, id); }
}
