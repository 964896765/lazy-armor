import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { AcquireFactDemandsDto, ResolveFactDemandsDto } from './dto';
import { FactDemandResolverService } from './fact-demand-resolver.service';

@Controller('runtime/fact-demands')
export class FactDemandsController {
  constructor(private readonly resolver: FactDemandResolverService) {}

  @Post('acquire')
  acquire(@CurrentUser() user:AuthenticatedUser,@Body() input:AcquireFactDemandsDto){return this.resolver.acquire(user.id,input);}

  @Post('resolve')
  resolve(@CurrentUser() user: AuthenticatedUser, @Body() input: ResolveFactDemandsDto) {
    return this.resolver.resolve(user.id, input);
  }
}
