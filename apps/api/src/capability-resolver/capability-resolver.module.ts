import { Module, Controller, Post, Get, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { AuditModule } from '../audit/audit.module';
import { ProviderCapabilitiesModule } from '../provider-capabilities/provider-capabilities.module';
import { CapabilityResolverService } from './capability-resolver.service';
import { ResolveCapabilityDto } from './dto';
import { ResolutionEvidenceService } from './resolution-evidence.service';

@Controller('capability-resolutions')
class CapabilityResolverController {
  constructor(private readonly resolver: CapabilityResolverService) {}
  @Post() resolve(@CurrentUser() user: AuthenticatedUser, @Body() input: ResolveCapabilityDto) { return this.resolver.resolve(user.id, input); }
  @Get(':id') get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.resolver.get(user.id, id); }
}

@Module({ imports: [AuditModule, ProviderCapabilitiesModule], controllers: [CapabilityResolverController],
  providers: [CapabilityResolverService, ResolutionEvidenceService], exports: [CapabilityResolverService, ResolutionEvidenceService] })
export class CapabilityResolverModule {}
