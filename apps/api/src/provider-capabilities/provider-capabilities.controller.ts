import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser, Roles, type AuthenticatedUser } from '../common/auth-context';
import { CapabilityUsabilityService } from './capability-usability.service';
import { ProviderCapabilityRegistryService } from './provider-capability-registry.service';

@Roles('super_admin', 'operations_readonly')
@Controller('provider-capabilities')
export class ProviderCapabilitiesController {
  constructor(private readonly registry: ProviderCapabilityRegistryService) {}
  @Get() list() { return this.registry.list(); }
  @Get(':providerKey') get(@Param('providerKey') providerKey: string) { return this.registry.get(providerKey); }
}

@Controller('connections')
export class ConnectionCapabilityController {
  constructor(private readonly usability: CapabilityUsabilityService) {}
  @Get(':id/capabilities') get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.usability.resolveConnection(user.id, id); }
}
